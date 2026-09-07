export interface IVMSyntaxMatrixFixture {
    readonly name: string;
    readonly body: string;
    readonly argument: string;
}

export const VM_SYNTAX_MATRIX: readonly IVMSyntaxMatrixFixture[] = [
    {
        name: 'whole optional chains with receiver binding and skipped side effects',
        argument: 'null',
        body: `
            const events = [];
            const object = { user: {
                name: 'reader',
                method(value) { return { result: this.name + value }; }
            } };
            let groupedThrows = false;
            try { (input?.user).name; } catch (error) {
                groupedThrows = error instanceof TypeError;
            }
            return [
                input?.user.name ?? 'missing',
                input?.[events.push('key')].method(events.push('argument')),
                object?.user.method?.('!').result,
                object?.user.absent?.(events.push('argument')).result,
                events,
                groupedThrows
            ];
        `
    },
    {
        name: 'closure captures in loop headers bodies switch and catch blocks',
        argument: '[2, 3]',
        body: `
            const values = [];
            for (let index = 0; index < input.length; index++) {
                values.push((() => index)());
            }
            for (const item of input) {
                const doubled = item * 2;
                values.push((() => doubled)());
            }
            for (const key in { entry: 1 }) {
                values.push((() => key)());
            }
            switch (input.length) {
                case 2: {
                    const matched = 'pair';
                    values.push((() => matched)());
                    break;
                }
            }
            try {
                throw 'caught';
            } catch (error) {
                const message = error + '!';
                values.push((() => message)());
            }
            return values;
        `
    },
    {
        name: 'compound property assignment reference evaluation',
        argument: '3',
        body: `
            const events = [];
            let value = 7;
            const object = {
                get amount() { events.push('get'); return value; },
                set amount(next) { events.push('set'); value = next; }
            };
            const key = {
                [Symbol.toPrimitive](hint) { events.push(hint); return 'amount'; }
            };
            function receiver() { events.push('object'); return object; }
            function right() { events.push('right'); value = 100; return input; }
            const result = receiver()[key] *= right();
            const symbol = Symbol('value');
            const keyed = { [symbol]: 9n };
            keyed[Object(symbol)] += 2n;
            return [result, value, events, String(keyed[symbol])];
        `
    },
    {
        name: 'objects methods arrays holes spread and loops',
        argument: '[2, 3]',
        body: `
            let total = 0;
            const object = { a: 1, get b () { return 2; }, method (value) { return value + 1; } };
            const values = [1, , ...input];
            for (let index = 0; index < values.length; index++) {
                if (index in values) total += values[index];
            }
            for (const key in object) {
                if (typeof object[key] === 'number') total += object[key];
            }
            return [total, object.method(2), { ...object, c: 3 }.c];
        `
    },
    {
        name: 'switch exceptions logical optional and nullish expressions',
        argument: '[2, 3]',
        body: `
            let total = 0;
            switch (input.length) {
                case 2: total += 3; break;
                default: total -= 1;
            }
            try {
                throw 4;
            } catch (value) {
                total += value;
            } finally {
                total += 1;
            }
            const object = { method (value) { return value + 1; } };
            return [total, (null ?? 5) && (0 || 7), object?.method?.(2)];
        `
    },
    {
        name: 'templates tagged templates regexp bigint and nested patterns',
        argument: '[2, 3]',
        body: `
            const tag = (strings, ...values) => strings.raw[0] + values.join(':');
            const nested = () => {
                const [first = 9, ...rest] = input;
                return [first, rest.length];
            };
            const [character, ...characters] = 'abc';
            return [
                \`v=\${input.length}\`,
                tag\`x\${1}y\${2}\`,
                /ab+/gi.test('ABb'),
                String(2n ** 3n),
                nested(),
                [character, characters]
            ];
        `
    },
    {
        name: 'native classes computed fields static blocks private and super',
        argument: '5',
        body: `
            let value = input;
            const order = [];
            class Parent { method () { return 1; } }
            class Child extends Parent {
                static [order.push('key') && 'saved'] = (order.push('static'), value);
                #privateValue = (order.push('field'), value);
                constructor () { super(); order.push('constructor'); }
                method () { value++; return super.method() + this.#privateValue + value; }
                static { order.push('block'); value += 2; }
            }
            const child = new Child();
            return [child.method(), Child.saved, order, value];
        `
    }
];
