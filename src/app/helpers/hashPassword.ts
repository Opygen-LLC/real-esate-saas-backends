import bcrypt from 'bcryptjs'
import config from '../../config'

const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(Number(config.bcrypt_salt_rounds))
  return await bcrypt.hash(password, salt)
}

export default hashPassword
