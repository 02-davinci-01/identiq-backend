// src/modules/themes/entities/theme.entity.ts
import {
  Entity,
  Column,
  ObjectIdColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from "typeorm";
import { ObjectId } from "mongodb";

/**
 * Embedded custom theme item stored in `customThemes` array column.
 */
export class CustomThemeItem {
  themeId!: string; // e.g. "ntcjs"
  label!: string; // human-readable name
  hex!: string; // normalized #RRGGBB
  createdAt!: Date;
  updatedAt!: Date;
}

@Entity({ name: "themes" })
@Unique(["email"])
export class Theme {
  @ObjectIdColumn()
  id!: ObjectId;

  @Column()
  @Index()
  email!: string;

  // server-side selected themeId / color (keeps backward compatibility)
  @Column({ default: "light" })
  themeId!: string;

  @Column({ nullable: true })
  label?: string | null;

  // remove img field as requested (was previously present)
  // @Column({ nullable: true })
  // img?: string | null;

  @Column({ default: "#c96a2b" })
  colorHex!: string;

  /**
   * New: customThemes array (stored as JSON)
   * - each item conforms to CustomThemeItem
   * - simple-json is easiest for storing an array of small objects with TypeORM + Mongo
   */
  @Column({ type: "simple-json", default: "[]" })
  customThemes!: CustomThemeItem[];

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
