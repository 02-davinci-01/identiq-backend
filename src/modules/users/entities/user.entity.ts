import {
  Entity,
  Column,
  ObjectIdColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ObjectId,
} from "typeorm";
//this is my db schema
@Entity("users")
export class User {
  @ObjectIdColumn()
  _id: ObjectId; //would be valid after the mongodb i guess

  @Column({ unique: true })
  email: string;

  @Column()
  name: string;

  //storing the color id reference
  @Column()
  themeId?: string;

  //rest for quick lookup

  @Column({ nullable: true })
  selectedTheme?: string; //the three names that we have

  @Column({ nullable: true })
  colorHex?: string; //hex code

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
