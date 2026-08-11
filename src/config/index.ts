import dotenv from 'dotenv'
import path from 'path'

dotenv.config({
  path: path.join(process.cwd(), '.env'),
})

export default {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 5000,
  database_string: process.env.DATABASE_URL || 'mongodb://127.0.0.1:27017/real-estate-saas',
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS || '10',
  app_email: process.env.APP_EMAIL,
  app_password: process.env.APP_PASSWORD,
  jwt: {
    secret: process.env.JWT_SECRET || 'real_estate_saas_jwt_secret_key_2026_secure',
    refresh_secret: process.env.JWT_REFRESH_SECRET || 'real_estate_saas_jwt_refresh_secret_key_2026_secure',
    expires_in: process.env.JWT_EXPIRES_IN || '7d',
    refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
}
