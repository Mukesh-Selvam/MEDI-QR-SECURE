import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser, type AuthenticatedUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePolicy } from "../auth/decorators/policy.decorator.js";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard.js";
import { PolicyGuard } from "../auth/guards/policy.guard.js";
import { NotificationsService } from "./notifications.service.js";

@Controller("notifications")
@UseGuards(JwtAuthGuard, PolicyGuard)
export class NotificationsController {
  constructor(
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService
  ) {}

  @Get()
  @RequirePolicy({ resource: "notification", action: "list" })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.notifications.listForUser(user.id);
  }

  @Patch(":id/read")
  @RequirePolicy({ resource: "notification", action: "update" })
  async markRead(
    @Param("id", ParseUUIDPipe) notificationId: string,
    @CurrentUser() user: AuthenticatedUser
  ): Promise<{ read: true }> {
    await this.notifications.markRead(user.id, notificationId);
    return { read: true };
  }
}
