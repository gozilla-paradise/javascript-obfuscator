import { Utils } from '../../utils/Utils';

export const VMDefenseReaction: Readonly<{
    Break: 'break';
    Decoy: 'decoy';
    None: 'none';
}> = Utils.makeEnum({
    Break: 'break',
    Decoy: 'decoy',
    None: 'none'
});
