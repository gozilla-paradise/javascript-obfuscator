/* eslint-disable @typescript-eslint/naming-convention */
import { TTypeFromEnum } from '../../types/utils/TTypeFromEnum';

import { VMBytecodeFormat } from '../../enums/vm/VMBytecodeFormat';

import { IVMProgram } from './IVMProgram';

export type IVMSerializedProgram =
    | {
          readonly format: typeof VMBytecodeFormat.Binary;
          readonly program: IVMProgram;
          readonly bytes: Uint8Array;
          readonly json: null;
      }
    | {
          readonly format: typeof VMBytecodeFormat.Json;
          readonly bytes: null;
          readonly program: IVMProgram;
          readonly json: string;
      };

export interface IVMSerializer {
    serialize(
        program: IVMProgram,
        format: TTypeFromEnum<typeof VMBytecodeFormat>
    ): IVMSerializedProgram;

    deserialize(program: IVMSerializedProgram): IVMProgram;
}
