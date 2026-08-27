import { ContainerModule, ContainerModuleLoadOptions } from 'inversify';

import { ServiceIdentifiers } from '../../ServiceIdentifiers';

import type { IVMBytecodeProtector } from '../../../interfaces/vm/IVMBytecodeProtector';
import type { IVMCompiler } from '../../../interfaces/vm/IVMCompiler';
import type { IVMFunctionSelector } from '../../../interfaces/vm/IVMFunctionSelector';
import type { IVMRuntimeBuilder } from '../../../interfaces/vm/IVMRuntimeBuilder';
import type { IVMSerializer } from '../../../interfaces/vm/IVMSerializer';

import { VMBytecodeProtector } from '../../../vm/VMBytecodeProtector';
import { VMCompiler } from '../../../vm/VMCompiler';
import { VMFunctionSelector } from '../../../vm/VMFunctionSelector';
import { VMRuntimeBuilder } from '../../../vm/VMRuntimeBuilder';
import { VMSerializer } from '../../../vm/VMSerializer';

export const vmModule: ContainerModule = new ContainerModule(
    (options: ContainerModuleLoadOptions) => {
        options
            .bind<IVMBytecodeProtector>(ServiceIdentifiers.IVMBytecodeProtector)
            .to(VMBytecodeProtector)
            .inSingletonScope();
        options
            .bind<IVMCompiler>(ServiceIdentifiers.IVMCompiler)
            .to(VMCompiler)
            .inSingletonScope();
        options
            .bind<IVMFunctionSelector>(ServiceIdentifiers.IVMFunctionSelector)
            .to(VMFunctionSelector)
            .inSingletonScope();
        options
            .bind<IVMRuntimeBuilder>(ServiceIdentifiers.IVMRuntimeBuilder)
            .to(VMRuntimeBuilder)
            .inSingletonScope();
        options
            .bind<IVMSerializer>(ServiceIdentifiers.IVMSerializer)
            .to(VMSerializer)
            .inSingletonScope();
    }
);
