import {
  Entity,
  Column,
  ObjectIdColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ObjectId,
} from "typeorm";
//this is my db schema
@Entity("auth")
export class Auth {
  @ObjectIdColumn()
  _id: ObjectId; //would be valid after the mongodb i guess

  @Column({ unique: true })
  email: string;

  @Column({ nullable: true })
  updEmail?: string | null;

  @Column()
  name: string;

  @Column({ nullable: true })
  verifyEmailTokenHash?: string | null;

  @Column({ nullable: true })
  verifyEmailExpiry?: Date | null;

  @Column({ default: false })
  emailVerified: boolean;

  @Column({ nullable: true })
  passwordHash?: string;

  @Column({ nullable: true })
  resetPasswordTokenHash?: string | null;

  @Column({ nullable: true, type: "timestamp", name: "resetPasswordExpiry" })
  resetPasswordExpiry?: Date | null;

  @Column({ type: "simple-array", nullable: true })
  jids: string[];
}
