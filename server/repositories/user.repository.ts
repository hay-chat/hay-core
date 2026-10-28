import { AppDataSource } from "../database/data-source";
import { User } from "../entities/user.entity";

class UserRepository {
  private repository = AppDataSource.getRepository(User);

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
