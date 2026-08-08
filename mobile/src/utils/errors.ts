// Error handling utilities

export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

export const handleApiError = (error: any): APIError => {
  if (error instanceof APIError) {
    return error;
  }

  if (error?.response?.data) {
    const { status, code, message } = error.response.data;
    return new APIError(
      error.response.status || status,
      code || 'UNKNOWN_ERROR',
      message || 'An unknown error occurred'
    );
  }

  if (error?.message) {
    return new APIError(500, 'UNKNOWN_ERROR', error.message);
  }

  return new APIError(500, 'UNKNOWN_ERROR', 'An unknown error occurred');
};

export const getErrorMessage = (error: any): string => {
  if (error instanceof APIError) {
    return error.message;
  }

  if (error?.response?.data?.message) {
    return error.response.data.message;
  }

  if (error?.message) {
    return error.message;
  }

  return 'An unknown error occurred';
};

export const isNetworkError = (error: any): boolean => {
  return (
    !error?.response ||
    error?.code === 'ECONNABORTED' ||
    error?.message?.includes('Network')
  );
};

export const isAuthError = (error: any): boolean => {
  return (
    error?.response?.status === 401 ||
    error?.response?.status === 403 ||
    error?.code === 'UNAUTHORIZED'
  );
};

export const isNotFoundError = (error: any): boolean => {
  return error?.response?.status === 404;
};

export const isValidationError = (error: any): boolean => {
  return error?.response?.status === 400 || error?.code === 'VALIDATION_ERROR';
};
