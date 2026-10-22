import { env } from '../config/env.js';

export const notFound = (_req, res) => res.status(404).json({ error: 'Not found' });

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err); // never leak internals to the client
  res.status(status).json({
    error: status === 500 ? 'Something went wrong' : err.message,
    ...(err.details && { details: err.details }),
    ...(env.NODE_ENV === 'development' && status === 500 && { debug: err.message }),
  });
};
