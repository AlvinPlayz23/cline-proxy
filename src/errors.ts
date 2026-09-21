/** Error with an OpenAI-style HTTP status code. */
export class ProxyError extends Error {
	status: number;
	code: string;

	constructor(status: number, message: string, code = "invalid_request_error") {
		super(message);
		this.name = "ProxyError";
		this.status = status;
		this.code = code;
	}
}
