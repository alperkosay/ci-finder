export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "UNKNOWN_COMMAND"
  | "NOT_FOUND"
  | "EXISTS"
  | "INVALID_NAME"
  | "NOT_A_DIRECTORY"
  | "NOT_A_FILE"
  | "FORBIDDEN"
  | "READ_ONLY"
  | "LOCKED"
  | "EXTENSION_DENIED"
  | "TOO_LARGE"
  | "MOVE_INTO_ITSELF"
  | "UNSUPPORTED"
  | "INVALID_ARCHIVE"
  | "INVALID_IMAGE"
  | "STORAGE"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  UNKNOWN_COMMAND: 400,
  NOT_FOUND: 404,
  EXISTS: 409,
  INVALID_NAME: 400,
  NOT_A_DIRECTORY: 400,
  NOT_A_FILE: 400,
  FORBIDDEN: 403,
  READ_ONLY: 403,
  LOCKED: 403,
  EXTENSION_DENIED: 403,
  TOO_LARGE: 413,
  MOVE_INTO_ITSELF: 400,
  UNSUPPORTED: 400,
  INVALID_ARCHIVE: 400,
  INVALID_IMAGE: 400,
  STORAGE: 502,
  INTERNAL: 500,
};

export class CiFinderError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string = code) {
    super(message);
    this.name = "CiFinderError";
    this.code = code;
    this.status = STATUS[code];
  }
}

export const isCiFinderError = (e: unknown): e is CiFinderError => e instanceof CiFinderError;
