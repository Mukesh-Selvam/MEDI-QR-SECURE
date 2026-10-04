/**
 * IdentityModule — top-level identity domain module.
 * Delegates auth logic to AuthModule (OTP, sessions, guards).
 */
import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  exports: [AuthModule],
})
export class IdentityModule {}
