import { AppDataSource } from "../database/data-source";
import { Document } from "../entities/document.entity";

export class DocumentRepository {
  private repository = AppDataSource.getRepository(Document);

  async create(data: Partial<Document>): Promise<Document> {
    const document = this.repository.create(data);
    return await this.repository.save(document);
  }

  async findById(id: string, organizationId: string): Promise<Document | null> {
    return await this.repository.findOne({
      where: { id, organizationId },
    });
  }

  async findByOrganization(organizationId: string): Promise<Document[]> {
    return await this.repository.find({
      where: { organizationId },
    });
  }

  async update(id: string, organizationId: string, data: Partial<Document>): Promise<Document | null> {
    const result = await this.repository.update(
      { id, organizationId },
      data
    );
    
    if (result.affected === 0) {
      return null;
    }
    
    return await this.findById(id, organizationId);
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.repository.delete({
      id,
      organizationId,
    });
    
    return result.affected !== 0;
  }
}

export const documentRepository = new DocumentRepository();
