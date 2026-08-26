import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { typeOrmConfig } from './typeorm.config';

dotenv.config();

const opts = typeOrmConfig() as DataSourceOptions;

export const AppDataSource = new DataSource(opts);
export default AppDataSource;
