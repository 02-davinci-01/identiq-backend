import { ObjectIdColumn, Column, ObjectId} from "typeorm";


export class Theme{
    @ObjectIdColumn()
    _id: ObjectId;

    @Column()
    key:string
    
    @Column()
    name:string

    //optional feature
    @Column('simple-json')
    palette: {
    primary: string;
    secondary?: string;
    background?: string;
    text?: string;
    [k: string]: string | undefined;
  };



}