import { Utils } from '../../utils/Utils';

export const VMDefenseCategory: Readonly<{
    Automation: 'automation';
    Debugger: 'debugger';
    Sandbox: 'sandbox';
    Domain: 'domain';
    Tamper: 'tamper';
    Integrity: 'integrity';
}> = Utils.makeEnum({
    Automation: 'automation',
    Debugger: 'debugger',
    Sandbox: 'sandbox',
    Domain: 'domain',
    Tamper: 'tamper',
    Integrity: 'integrity'
});
