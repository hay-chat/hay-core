import { DefaultNamingStrategy } from "typeorm";
import type { NamingStrategyInterface } from "typeorm";

// Helper function to convert camelCase to snake_case
function snakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, '');
}

export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override tableName(targetName: string, userSpecifiedName: string | undefined): string {
    return userSpecifiedName ? userSpecifiedName : snakeCase(targetName);
  }

  override columnName(propertyName: string, customName: string | undefined, embeddedPrefixes: string[]): string {
    return snakeCase(embeddedPrefixes.concat(customName ? customName : propertyName).join("_"));
  }

  columnNameCustomized(customName: string): string {
    return customName;
  }

  override relationName(propertyName: string): string {
    return snakeCase(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(relationName + "_" + referencedColumnName);
  }

  override joinTableName(firstTableName: string, secondTableName: string, firstPropertyName: string, secondPropertyName: string): string {
    return snakeCase(firstTableName + "_" + firstPropertyName.replace(/\./gi, "_") + "_" + secondTableName);
  }

  override joinTableColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return snakeCase(tableName + "_" + (columnName ? columnName : propertyName));
  }

  classTableInheritanceParentColumnName(parentTableName: string, parentTableIdPropertyName: string): string {
    return snakeCase(parentTableName + "_" + parentTableIdPropertyName);
  }

  eagerJoinRelationAlias(alias: string, propertyPath: string): string {
    return alias + "__" + propertyPath.replace(".", "_");
  }
}