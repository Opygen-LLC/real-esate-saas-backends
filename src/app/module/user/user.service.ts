import bcrypt from 'bcryptjs'
import httpStatus from 'http-status'
import config from '../../../config'
import ApiError from '../../../errors/ApiError'
import { IGenericResponse, IPaginationOptions } from '../../../interfaces/common'
import generateRandomCode from '../../../shared/generateRandomCode'
import hashPassword from '../../helpers/hashPassword'
import paginationHelper from '../../helpers/paginationHelper'
import sendOtp from '../../helpers/sendOtp'
import { Lead } from '../lead/lead.model'
import { Property } from '../property/property.model'
import { Viewing } from '../viewing/viewing.model'
import { IUser, IUserFilter } from './user.interface'
import { User } from './user.model'

const createUser = async (userData: IUser): Promise<IUser> => {
  userData.verificationCode = generateRandomCode()
  userData.codeGenerationTimestamp = Date.now().toString()

  const existedEmail = await User.findOne({
    organizationId: userData.organizationId,
    email: userData.email,
  })
  if (existedEmail) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A user with this email already exists in this organization')
  }

  const existedPhone = await User.findOne({
    organizationId: userData.organizationId,
    phoneNumber: userData.phoneNumber,
  })
  if (existedPhone) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A user with this phone number already exists in this organization')
  }

  userData.password = await hashPassword(userData.password || '12345678')

  const user = await User.create(userData)
  if (!user) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to create user')
  }

  return user
}

const inviteAgent = async (
  organizationId: string,
  payload: { name: string; email: string; phoneNumber: string; userRole?: string; specialization?: string[] }
): Promise<IUser> => {
  const password = generateRandomCode(8) // Temporary auto-generated password

  const userData: Partial<IUser> = {
    ...payload,
    organizationId,
    password,
    userRole: (payload.userRole as any) || 'agent',
    isVerified: true,
    status: 'active',
  }

  const result = await createUser(userData as IUser)
  return result
}

const getAllUsers = async (
  filters: IUserFilter,
  paginationOptions: IPaginationOptions
): Promise<IGenericResponse<IUser[]>> => {
  const { searchTerm, ...filterFields } = filters
  const andConditions: Array<Record<string, unknown>> = []

  if (searchTerm) {
    andConditions.push({
      $or: ['name', 'email', 'phoneNumber', 'licenseNumber'].map((field) => ({
        [field]: { $regex: searchTerm, $options: 'i' },
      })),
    })
  }

  if (Object.keys(filterFields).length) {
    andConditions.push({
      $and: Object.entries(filterFields).map(([key, value]) => ({ [key]: value })),
    })
  }

  const whereCondition = andConditions.length ? { $and: andConditions } : {}
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)

  const result = await User.find(whereCondition)
    .select('-password')
    .sort({ [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit)

  const total = await User.countDocuments(whereCondition)

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: result,
  }
}

const getPublicAgents = async (organizationId: string): Promise<any[]> => {
  const agents = await User.find({
    organizationId,
    userRole: { $in: ['agent', 'agency_admin', 'agency_owner', 'admin', 'staff'] },
  }).select('name email phoneNumber profileImgURL licenseNumber bio specialization')

  const agentsWithStats = await Promise.all(
    agents.map(async (agent) => {
      const activeListings = await Property.countDocuments({
        organizationId,
        agentId: agent._id,
        status: 'Available',
      })
      const closedDeals = await Lead.countDocuments({
        organizationId,
        assignedAgent: agent._id,
        leadStatus: 'Won',
      })

      return {
        _id: agent._id,
        name: agent.name,
        email: agent.email,
        phoneNumber: agent.phoneNumber,
        profileImgURL: agent.profileImgURL,
        licenseNumber: agent.licenseNumber,
        bio: agent.bio,
        specialization: agent.specialization,
        activeListings,
        closedDeals,
      }
    })
  )

  return agentsWithStats
}

const getPublicAgentDetail = async (agentId: string): Promise<any> => {
  const agent = await User.findById(agentId).select(
    'name email phoneNumber profileImgURL licenseNumber bio specialization organizationId'
  )
  if (!agent) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Broker profile not found')
  }

  const activeProperties = await Property.find({
    organizationId: agent.organizationId,
    agentId: agent._id,
    status: 'Available',
  }).select('title price images city propertyType bedrooms bathrooms area areaUnit listingType')

  return {
    agent,
    activeProperties,
  }
}

const getAgentLeaderboard = async (organizationId: string): Promise<any[]> => {
  const agents = await User.find({
    organizationId,
    userRole: { $in: ['agent', 'agency_admin', 'agency_owner', 'admin', 'staff'] },
  }).select('name email phoneNumber profileImgURL licenseNumber specialization')

  const leaderboard = await Promise.all(
    agents.map(async (agent) => {
      const agentId = agent._id
      const totalLeads = await Lead.countDocuments({ organizationId, assignedAgent: agentId })
      const dealsWon = await Lead.countDocuments({ organizationId, assignedAgent: agentId, leadStatus: 'Won' })
      const totalViewings = await Viewing.countDocuments({ organizationId, agentId })
      const activeListings = await Property.countDocuments({ organizationId, agentId, status: 'Available' })

      const conversionRate = totalLeads > 0 ? Math.round((dealsWon / totalLeads) * 100) : 0

      return {
        agent: {
          _id: agent._id,
          name: agent.name,
          email: agent.email,
          phoneNumber: agent.phoneNumber,
          profileImgURL: agent.profileImgURL,
          licenseNumber: agent.licenseNumber,
          specialization: agent.specialization,
        },
        totalLeads,
        dealsWon,
        totalViewings,
        activeListings,
        conversionRate,
      }
    })
  )

  return leaderboard.sort((a, b) => b.dealsWon - a.dealsWon || b.totalLeads - a.totalLeads)
}

const getUserById = async (id: string): Promise<IUser | null> => {
  const result = await User.findById(id).select('-password')
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  }
  return result
}

const updateUserById = async (id: string, userData: Partial<IUser>): Promise<IUser | null> => {
  if (userData.password) {
    userData.password = await hashPassword(userData.password)
  }

  const result = await User.findByIdAndUpdate(id, userData, { new: true }).select('-password')
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  }
  return result
}

const deleteUserById = async (id: string): Promise<IUser | null> => {
  const result = await User.findByIdAndDelete(id)
  if (!result) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  }
  return result
}

const getAllUsersSuperAdmin = async (filters: IUserFilter, paginationOptions: IPaginationOptions) => {
  const { searchTerm, userRole, status, ...filtersData } = filters
  const { page, limit, skip, sortBy, sortOrder } = paginationHelper.calculatePagination(paginationOptions)

  const andConditions: any[] = []

  if (searchTerm) {
    andConditions.push({
      $or: ['name', 'email', 'phoneNumber', 'organizationId'].map((field) => ({
        [field]: {
          $regex: searchTerm,
          $options: 'i',
        },
      })),
    })
  }

  if (userRole) andConditions.push({ userRole })
  if (status) andConditions.push({ status })

  if (Object.keys(filtersData).length) {
    andConditions.push({
      $and: Object.entries(filtersData).map(([field, value]) => ({
        [field]: value,
      })),
    })
  }

  const sortConditions: { [key: string]: any } = {}
  if (sortBy && sortOrder) {
    sortConditions[sortBy] = sortOrder
  } else {
    sortConditions.createdAt = -1
  }

  const whereConditions = andConditions.length > 0 ? { $and: andConditions } : {}

  const result = await User.find(whereConditions).sort(sortConditions).skip(skip).limit(limit)
  const total = await User.countDocuments(whereConditions)

  return {
    meta: {
      page,
      limit,
      total,
    },
    data: result,
  }
}

const updateUserRoleSuperAdmin = async (id: string, payload: { userRole?: string; status?: string }) => {
  const user = await User.findById(id)
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found')
  }

  const result = await User.findByIdAndUpdate(id, payload, { new: true })
  return result
}

export const UserService = {
  createUser,
  inviteAgent,
  getAllUsers,
  getPublicAgents,
  getPublicAgentDetail,
  getAgentLeaderboard,
  getUserById,
  updateUserById,
  deleteUserById,
  getAllUsersSuperAdmin,
  updateUserRoleSuperAdmin,
}
