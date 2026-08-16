import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (file) => fs.readFileSync(file, 'utf8')

const sessionModel = read('src/app/module/auth/authSession.model.ts')
assert.match(sessionModel, /refreshTokenHash/)
assert.match(sessionModel, /authorizationVersion/)
assert.match(sessionModel, /authorizationChangedAt/)
assert.match(sessionModel, /delete ret\.refreshTokenHash/)

const userDto = read('src/app/module/user/user.dto.ts')
const profileService = read('src/app/module/user/userProfile.service.ts')
assert.match(userDto, /authorizationUpdatedAt\?: string/)
assert.match(profileService, /authorizationUpdatedAt:/)

const authController = read('src/app/module/auth/auth.controller.ts')
assert.match(authController, /Cache-Control.*no-store/)
assert.match(authController, /Vary.*Cookie/)

const authMiddleware = read('src/app/middlewares/auth.ts')
assert.match(authMiddleware, /User\.findById\(/)
assert.match(authMiddleware, /toAuthUserDto/)

const userService = read('src/app/module/user/user.service.ts')
assert.match(userService, /markSessionAuthorizationChanged/)
assert.match(userService, /AuthSession\.updateMany/)
assert.match(userService, /authorizationChangedAt/)
assert.match(userService, /authorizationVersion/)
assert.match(userService, /updateUserRoleSuperAdmin/)
assert.match(userService, /updateMemberAccess/)

const requestTypes = read('src/interfaces/index.d.ts')
assert.match(requestTypes, /authorizationUpdatedAt\?: string/)

console.log('Phase 3 auth/routing architecture verification passed.')
