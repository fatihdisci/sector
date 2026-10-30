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
        self.safe_receipt = {}

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
            self.safe_receipt = {"http_status": int(response.status_code) if hasattr(response,"status_code") else int(response.status)}
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
            self.safe_receipt['response_json_received'] = parsed is not None
            error = parsed.get('error') if parsed else None
            if isinstance(error,dict):
                allowed = {'invalid_api_key','insufficient_quota','model_not_found','model_not_available','unsupported_parameter','invalid_request_error','rate_limit_exceeded','permission_denied','invalid_project','project_not_found','billing_hard_limit_reached','unsupported_value','organization_restricted'}
                value = error.get('code') or error.get('type')
                self.safe_receipt['provider_error_class'] = value if isinstance(value,str) and value in allowed else 'other'
                params={'model','input','instructions','max_output_tokens','reasoning','reasoning.effort','text','text.format','text.format.type','service_tier','tool_choice','tools','store','background','truncation','stream'}
                param=error.get('param')
                self.safe_receipt['provider_error_param']=param if isinstance(param,str) and param in params else 'other'
                # Read the message only in memory; persist an enum, never message text.
                message=error.get('message','');message=message.lower() if isinstance(message,str) else ''
                reason='unclassified'
                if 'json' in message and ('input' in message or 'messages' in message) and ('contain' in message or 'include' in message):reason='json_input_instruction_required'
                elif 'service_tier' in message and ('not allowed' in message or 'invalid' in message):reason='service_tier_not_allowed'
                elif 'not supported' in message or 'unsupported' in message:reason='unsupported_parameter_or_value'
                elif 'model' in message and ('access' in message or 'permission' in message):reason='model_access_not_allowed'
                self.safe_receipt['provider_error_reason']=reason
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
