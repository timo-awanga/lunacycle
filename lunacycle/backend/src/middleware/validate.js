import { AppError } from '../utils/errors.js';

// validate(zodSchema) -> replaces req.body with parsed (stripped, typed) data.
export const validate = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(new AppError(400, 'Invalid input', details));
  }
  req.body = result.data;
  next();
};
