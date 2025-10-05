import { AppDataSource } from "../database/data-source";
import { User } from "../entities/user.entity";

class UserRepository {
  private repository = AppDataSource.getRepository(User);

  /**
   * Find all online users for a given organization
   * A user is online if: lastSeenAt < 120 seconds ago AND status = 'available'
   */
  async findOnlineByOrganization(organizationId: string): Promise<User[]> {
    const twoMinutesAgo = new Date(Date.now() - 120000); // 120 seconds in milliseconds

    return this.repository
      .find({
        where: {
          organizationId,
          status: "available",
          isActive: true,
        },
      })
      .then((users) => users.filter((user) => user.lastSeenAt && user.lastSeenAt >= twoMinutesAgo));
  }

  /**
   * Find user by ID
   */
  async findById(id: string): Promise<User | null> {
    return this.repository.findOne({
      where: { id },
      relations: ["organization"],
    });
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.repository.findOne({
      where: { email: email.toLowerCase() },
      relations: ["organization"],
    });
  }

  /**
   * Update user's last seen timestamp
   */
  async updateLastSeen(userId: string): Promise<void> {
    await this.repository.update(userId, {
      lastSeenAt: new Date(),
    });
  }

  /**
   * Update user status
   */
  async updateStatus(userId: string, status: "available" | "away"): Promise<void> {
    await this.repository.update(userId, {
      status,
    });
  }
}

export const userRepository = new UserRepository();
