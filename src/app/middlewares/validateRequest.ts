import { NextFunction, Request, Response } from 'express'
import { AnyZodObject, ZodEffects } from 'zod'

const validateRequest =
  (schema: AnyZodObject | ZodEffects<AnyZodObject>) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
        cookies: req.cookies,
      })
      if (parsed.body !== undefined) req.body = parsed.body
      if (parsed.params && typeof parsed.params === 'object') Object.assign(req.params, parsed.params)
      if (parsed.cookies && typeof parsed.cookies === 'object') req.cookies = parsed.cookies
      return next()
    } catch (error) {
      next(error)
    }
  }

export default validateRequest
