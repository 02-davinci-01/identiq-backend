// src/modules/themes/entities/theme.entity.ts
import {
  Entity,
  Column,
  ObjectIdColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import { ObjectId } from 'mongodb';

@Entity({ name: 'themes' })
@Unique(['email'])
export class Theme {
  @ObjectIdColumn()
  id!: ObjectId;

  @Column()
  @Index()
  email!: string;

  @Column({ default: 'light' })
  themeId!: string;

  @Column({ nullable: true })
  label?: string | null;

  @Column({ nullable: true })
  img?: string | null;

  @Column({ default: '#c96a2b' })
  colorHex!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
