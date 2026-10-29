"""Single-attempt Responses HTTPS transport. No credential discovery or SDK retries."""
import http.client
import json
import math
import ssl
import time

class ApiTransportError(RuntimeError):
    def __init__(self, code, response=None):
        super().__init__(code)
        self.response = response

class ResponsesHTTP:
    endpoint = 'api.openai.com'
    path = '/v1/responses'
    max_response_bytes = 4_000_000

    def __init__(self, key, *, deadline, timeout_seconds=120, connection_factory=None):
        if not isinstance(key, str) or not key.strip() or any(c in key for c in '\r\n'):
            raise RuntimeError('api_key_missing_or_invalid')
        if type(timeout_seconds) not in (int, float) or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 480:
            raise RuntimeError('api_timeout_invalid')
        self._key = key
        self.deadline = deadline
        self.timeout = timeout_seconds
        self.factory = connection_factory or http.client.HTTPSConnection

    def __call__(self, request):
        # Fixed official origin, system TLS verification, no proxy, redirects or retry.
        if request.get('tools') != [] or request.get('tool_choice') != 'none' or request.get('store') is not False:
            raise RuntimeError('api_request_safety_invalid')
        return self._post(request)

    def _post(self, request):
        body = json.dumps(request, ensure_ascii=False, allow_nan=False).encode('utf-8')
        stop = min(self.deadline, time.time() + self.timeout)
        def remaining():
            value = stop - time.time()
            if value <= 0:
                raise ApiTransportError('api_http_timeout_no_retry')
            return value
        connection = None
        try:
            connection = self.factory(self.endpoint, timeout=remaining(), context=ssl.create_default_context())
            connection.request('POST', self.path, body=body, headers={
                'Authorization': 'Bearer ' + self._key, 'Content-Type': 'application/json',
                'Accept': 'application/json', 'User-Agent': 'sector-haber-responses/1'})
            if getattr(connection, 'sock', None):
                connection.sock.settimeout(remaining())
            response = connection.getresponse()
            content = bytearray()
            while True:
                if getattr(connection, 'sock', None):
                    connection.sock.settimeout(remaining())
                else:
                    remaining()
                chunk = response.read(65536)
                if not chunk:
                    break
                content.extend(chunk)
                if len(content) > self.max_response_bytes:
                    raise ApiTransportError('api_http_response_too_large_no_retry')
            remaining()
            try:
                parsed = json.loads(content)
            except (ValueError, UnicodeError):
                raise ApiTransportError('api_http_invalid_json_no_retry') from None
            parsed = parsed if isinstance(parsed, dict) else None
            if not 200 <= response.status < 300:
                # No provider body, error text or response headers in the exception.
                code = {401:'api_http_auth_no_retry',403:'api_http_auth_no_retry',429:'api_http_rate_limited_no_retry'}.get(response.status, 'api_http_error_no_retry')
                raise ApiTransportError(code, parsed)
            if parsed is None:
                raise ApiTransportError('api_http_invalid_json_no_retry')
            return parsed
        except ApiTransportError:
            raise
        except TimeoutError:
            raise ApiTransportError('api_http_timeout_no_retry') from None
        except Exception:
            raise ApiTransportError('api_http_transport_uncertain_no_retry') from None
        finally:
            if connection is not None:
                try: connection.close()
                except Exception: pass
