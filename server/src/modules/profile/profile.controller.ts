import type { Request, Response } from "express";

import type { ProfileService } from "./profile.service.js";

export function createProfileController(profileService: ProfileService) {
  return {
    async getProfile(_request: Request, response: Response): Promise<void> {
      const profile = await profileService.getProfile();
      response.json({ data: profile });
    },
  };
}
