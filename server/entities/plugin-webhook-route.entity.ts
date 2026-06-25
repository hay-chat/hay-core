// PluginWebhookRoute — a plugin-agnostic index mapping (pluginId, routingKey) to
// the organization + plugin instance that owns it. Used so a shared webhook can
// resolve which org/instance an inbound account/routing key belongs to. Nothing
// here is specific to any individual plugin.

import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "./base.entity";
import { PluginInstance } from "./plugin-instance.entity";

@Entity("plugin_webhook_routes")
@Index(["pluginId", "routingKey"], { unique: true })
export class PluginWebhookRoute extends BaseEntity {
  @Column({ type: "varchar", length: 100 })
  pluginId!: string;

  @Column({ type: "varchar", length: 255 })
  routingKey!: string;

  @Index()
  @Column({ type: "uuid" })
  organizationId!: string;

  @Column({ type: "uuid" })
  pluginInstanceId!: string;

  @ManyToOne(() => PluginInstance, { onDelete: "CASCADE" })
  @JoinColumn()
  pluginInstance?: PluginInstance;
}
