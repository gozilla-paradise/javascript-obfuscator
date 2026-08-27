/* eslint-disable complexity */
import { injectable, injectFromBase } from 'inversify';

import { CodeTransformationStage } from '../../enums/code-transformers/CodeTransformationStage';

import { AbstractCodeTransformer } from '../AbstractCodeTransformer';
import { bytesToHex, sha256, utf8Bytes } from '../../vm/VMCrypto';

@injectFromBase()
@injectable()
export class VMIntegrityCodeTransformer extends AbstractCodeTransformer {
    private static readonly startMarker: string =
        '/* @preserve __JOVM_RUNTIME_START__ */';

    private static readonly endMarker: string =
        '/* @preserve __JOVM_RUNTIME_END__ */';

    private static readonly sentinel: string = '0'.repeat(64);

    public transformCode(
        code: string,
        codeTransformationStage: CodeTransformationStage
    ): string {
        if (
            codeTransformationStage !==
                CodeTransformationStage.FinalizingTransformers ||
            !this.options.vmSelfDefending
        ) {
            return code;
        }

        const startIndex: number = code.indexOf(
            VMIntegrityCodeTransformer.startMarker
        );
        const endIndex: number = code.indexOf(
            VMIntegrityCodeTransformer.endMarker
        );
        if (
            startIndex === -1 ||
            endIndex === -1 ||
            startIndex !==
                code.lastIndexOf(VMIntegrityCodeTransformer.startMarker) ||
            endIndex !== code.lastIndexOf(VMIntegrityCodeTransformer.endMarker) ||
            endIndex <= startIndex
        ) {
            throw new Error('Invalid VM runtime integrity delimiters');
        }

        const declarationStart: number =
            startIndex + VMIntegrityCodeTransformer.startMarker.length;
        let declaration: string = code.slice(declarationStart, endIndex).trim();
        if (declaration.endsWith(';')) {
            declaration = declaration.slice(0, -1);
        }
        const sentinelIndex: number = declaration.indexOf(
            VMIntegrityCodeTransformer.sentinel
        );
        if (
            sentinelIndex === -1 ||
            sentinelIndex !==
                declaration.lastIndexOf(VMIntegrityCodeTransformer.sentinel)
        ) {
            throw new Error('Invalid VM runtime integrity sentinel');
        }

        const digest: string = bytesToHex(
            sha256(utf8Bytes(declaration))
        );
        const absoluteSentinelIndex: number =
            code.indexOf(VMIntegrityCodeTransformer.sentinel, declarationStart);

        return (
            code.slice(0, absoluteSentinelIndex) +
            digest +
            code.slice(
                absoluteSentinelIndex +
                    VMIntegrityCodeTransformer.sentinel.length
            )
        );
    }
}
