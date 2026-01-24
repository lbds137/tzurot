/**
 * Tests for Profile API Helpers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fetchProfile,
  fetchDefaultProfile,
  updateProfile,
  deleteProfile,
  isDefaultProfile,
} from './api.js';

// Mock common-types
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

describe('Profile API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchProfile', () => {
    it('should fetch profile successfully', async () => {
      const mockPersona = {
        id: 'profile-123',
        name: 'Test Profile',
        preferredName: 'Tester',
        pronouns: 'they/them',
        isDefault: false,
      };

      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { persona: mockPersona },
      });

      const result = await fetchProfile('profile-123', 'user-123');

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/profile-123', {
        userId: 'user-123',
      });
      expect(result).toEqual(mockPersona);
    });

    it('should return null when fetch fails', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Not found',
        status: 404,
      });

      const result = await fetchProfile('profile-123', 'user-123');

      expect(result).toBeNull();
    });
  });

  describe('fetchDefaultProfile', () => {
    it('should fetch the default profile', async () => {
      const mockPersona = {
        id: 'default-profile',
        name: 'Default Profile',
        isDefault: true,
      };

      // First call to list personas
      mockCallGatewayApi.mockResolvedValueOnce({
        ok: true,
        data: {
          personas: [
            { id: 'other-profile', name: 'Other', isDefault: false },
            { id: 'default-profile', name: 'Default', isDefault: true },
          ],
        },
      });

      // Second call to fetch the default profile
      mockCallGatewayApi.mockResolvedValueOnce({
        ok: true,
        data: { persona: mockPersona },
      });

      const result = await fetchDefaultProfile('user-123');

      expect(mockCallGatewayApi).toHaveBeenNthCalledWith(1, '/user/persona', {
        userId: 'user-123',
      });
      expect(mockCallGatewayApi).toHaveBeenNthCalledWith(2, '/user/persona/default-profile', {
        userId: 'user-123',
      });
      expect(result).toEqual(mockPersona);
    });

    it('should return null when no default profile exists', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personas: [{ id: 'profile-1', name: 'Profile 1', isDefault: false }],
        },
      });

      const result = await fetchDefaultProfile('user-123');

      expect(result).toBeNull();
    });

    it('should return null when list fetch fails', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Server error',
        status: 500,
      });

      const result = await fetchDefaultProfile('user-123');

      expect(result).toBeNull();
    });
  });

  describe('updateProfile', () => {
    it('should update profile successfully', async () => {
      const updatedPersona = {
        id: 'profile-123',
        name: 'Updated Profile',
        preferredName: 'Updated Name',
      };

      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { persona: updatedPersona },
      });

      const result = await updateProfile(
        'profile-123',
        { name: 'Updated Profile', preferredName: 'Updated Name' },
        'user-123'
      );

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/profile-123', {
        method: 'PUT',
        userId: 'user-123',
        body: { name: 'Updated Profile', preferredName: 'Updated Name' },
      });
      expect(result).toEqual(updatedPersona);
    });

    it('should return null when update fails', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Validation error',
        status: 400,
      });

      const result = await updateProfile('profile-123', { name: '' }, 'user-123');

      expect(result).toBeNull();
    });
  });

  describe('deleteProfile', () => {
    it('should delete profile successfully', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: { message: 'Profile deleted' },
      });

      const result = await deleteProfile('profile-123', 'user-123');

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/profile-123', {
        method: 'DELETE',
        userId: 'user-123',
      });
      expect(result).toEqual({ success: true });
    });

    it('should return error when delete fails', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Cannot delete default profile',
        status: 400,
      });

      const result = await deleteProfile('profile-123', 'user-123');

      expect(result).toEqual({ success: false, error: 'Cannot delete default profile' });
    });
  });

  describe('isDefaultProfile', () => {
    it('should return true for default profile', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personas: [
            { id: 'profile-123', name: 'Default', isDefault: true },
            { id: 'other-profile', name: 'Other', isDefault: false },
          ],
        },
      });

      const result = await isDefaultProfile('profile-123', 'user-123');

      expect(result).toBe(true);
    });

    it('should return false for non-default profile', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personas: [
            { id: 'profile-123', name: 'Regular', isDefault: false },
            { id: 'default-profile', name: 'Default', isDefault: true },
          ],
        },
      });

      const result = await isDefaultProfile('profile-123', 'user-123');

      expect(result).toBe(false);
    });

    it('should return false when profile not found', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          personas: [{ id: 'other-profile', name: 'Other', isDefault: false }],
        },
      });

      const result = await isDefaultProfile('profile-123', 'user-123');

      expect(result).toBe(false);
    });

    it('should return false when list fetch fails', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        error: 'Server error',
        status: 500,
      });

      const result = await isDefaultProfile('profile-123', 'user-123');

      expect(result).toBe(false);
    });
  });
});
