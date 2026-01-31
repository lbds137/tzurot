/**
 * Authentication domain module
 * @module domain/authentication
 */

const { UserAuth } = require('./UserAuth');
const { Token } = require('./Token');
const { NsfwStatus } = require('./NsfwStatus');
const { AuthContext } = require('./AuthContext');
const { AuthenticationRepository } = require('./AuthenticationRepository');
const { TokenService } = require('./TokenService');
const {
  UserAuthenticated,
  UserTokenExpired,
  UserTokenRefreshed,
  UserNsfwVerified,
  UserNsfwVerificationCleared,
  AuthenticationDenied,
  ProxyAuthenticationAttempted,
} = require('./AuthenticationEvents');

module.exports = {
  // Aggregates
  UserAuth,

  // Value Objects
  Token,
  NsfwStatus,
  AuthContext,

  // Repositories
  AuthenticationRepository,

  // Services
  TokenService,

  // Events
  UserAuthenticated,
  UserTokenExpired,
  UserTokenRefreshed,
  UserNsfwVerified,
  UserNsfwVerificationCleared,
  AuthenticationDenied,
  ProxyAuthenticationAttempted,
};
