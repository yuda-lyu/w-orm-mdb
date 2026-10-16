import Sequelize from 'sequelize'
import { isWindows, cleanStorage } from './unit-setup.mjs'
import { ALL_TC as ALL, but as butAll, setupFind, runCase } from './unit-find-setup.mjs'


//spec: CLAUDE_rulebook.md 之 R-FIND-02/03(快照、入口、主鍵欄 $not 整體取反、深層邏輯之否定語境)與 R-PK-03/05
//本檔: 審計複審之 rv:A(主鍵欄 $not 之內部結構)、rv:B(非主鍵欄與 cvFind 分支)、rv:C(主鍵條件位於深層邏輯)、rv2:D($not 與 Op.not 並存)
//exp: 命中之主鍵(排序後逗號串接), '' 為無命中, 'REJECT' 為應拒收; 每列之斷言見 unit-find-setup.mjs 之 runCase


let Op = Sequelize.Op

function but(...xs) {
    return butAll(ALL, ...xs)
}

const L300 = 'z'.repeat(300)

//每次讀值結果不同之getter: 第一次{$ne:'a'}, 其後{$ne:'b'}; 快照令每個值只讀一次(R-FIND-02)
function flipGetter() {
    let n = 0
    return {
        get id() {
            n++
            return n === 1 ? { $ne: 'a' } : { $ne: 'b' }
        },
    }
}

function nonEnum(k, v) {
    let o = {}
    Object.defineProperty(o, k, { value: v, enumerable: false, configurable: true, writable: true })
    return o
}


const CASES = [
    //rv:A 主鍵欄 $not 之內部結構(R-FIND-03: 整體取反NOT(A∧B)並遞迴, 內層為否定語境)
    { key: 'rv:A1', find: () => ({ id: { $not: { $not: { $ne: 'A ' } } } }), exp: but('a') }, //雙層$not, Jet變體
    { key: 'rv:A2', find: () => ({ id: { $not: { $not: { $ne: '' } } } }), exp: 'REJECT' }, //雙層$not內之否定語境無效值
    { key: 'rv:A3', find: () => ({ id: { $not: { $not: 'A ' } } }), exp: 'a' },
    { key: 'rv:A4', find: () => ({ id: { $not: { $not: { $nin: ['A ', 'Ｂ'] } } } }), exp: but('a', 'b') },
    { key: 'rv:A5', find: () => ({ id: { [Op.not]: { [Op.not]: { [Op.ne]: '' } } } }), exp: 'REJECT' }, //Symbol形式
    { key: 'rv:A6', find: () => ({ id: { $not: { $in: ['a', 'b'], $gte: 'b' } } }), exp: but('b') }, //NOT之內多運算子
    { key: 'rv:A7', find: () => ({ id: { $not: { $eq: 'a', $ne: 'b' } } }), exp: but('a') }, //NOT(=a∧≠b)=≠a(1.0.35作¬A∧¬B而只命中b)
    { key: 'rv:A8', find: () => ({ id: { $not: { $gt: L300 } } }), exp: ALL }, //內層範圍之不可能存在值不命中, 取反為全部
    { key: 'rv:A8b', find: () => ({ $not: { id: { $gt: L300 } } }), exp: ALL }, //頂層$not對照
    { key: 'rv:A8c', find: () => ({ $nor: [{ id: { $gt: L300 } }] }), exp: ALL }, //$nor對照
    { key: 'rv:A9', find: () => ({ id: { $lt: L300 } }), exp: '' }, //肯定範圍之不可能存在值不命中(同1.0.35)
    { key: 'rv:A10', find: () => ({ id: { $not: [] } }), exp: ALL }, //主鍵$not陣列即$nin(1.0.35), 空即恆成立
    { key: 'rv:A11', find: () => ({ id: { $not: ['A '] } }), exp: but('a') },
    { key: 'rv:A12', find: flipGetter, exp: but('a') }, //快照: 值只讀一次
    { key: 'rv:A13', find: () => ({ id: { $not: { $regex: '_' } } }), exp: but('x_1') },
    { key: 'rv:A14', find: () => ({ id: { $not: { $regex: 'X', $options: 'i' }, $in: ['x_1', 'a'] } }), exp: 'a' },

    //rv:B 非主鍵欄與 cvFind 分支(reladb R2、R4、R5)
    { key: 'rv:B1', find: () => ({ nocol: { $nin: [] } }), exp: 'REJECT' }, //不存在之欄+空$nin: 嚴格鍵reject(reladb 1.1.9)
    { key: 'rv:B2', find: () => ({ nocol: { $in: [] } }), exp: 'REJECT' },
    { key: 'rv:B3', find: () => ({ nocol: { $not: { $in: [] } } }), exp: 'REJECT' },
    { key: 'rv:B4', find: () => ({ value: { $gt: 1, [Op.gt]: 5 } }), exp: 'i,j,x_1' }, //同義鍵各自成子式
    { key: 'rv:B5', find: () => ({ name: { $in: ['abc'], [Op.in]: ['peter'] } }), exp: '' },
    { key: 'rv:B6', find: () => ({ id: { $in: ['a', 'b'], [Op.in]: ['b', 'c'] } }), exp: 'b' }, //主鍵同義鍵並存
    { key: 'rv:B7', find: () => nonEnum('id', 'a'), exp: 'a' }, //不可列舉之主鍵鍵(Reflect.ownKeys)
    { key: 'rv:B8', find: () => nonEnum('name', 'abc'), exp: 'g' },
    { key: 'rv:B9', find: () => Object.assign(Object.create(null), { id: 'a' }), exp: 'a' }, //原型為null之一般物件
    { key: 'rv:B10', find: () => Object.create(null), exp: ALL }, //原型為null之空物件: 全部
    { key: 'rv:B11', find: () => JSON.parse('{"constructor":"x"}'), exp: 'REJECT' }, //Object.prototype成員名reject
    { key: 'rv:B12', find: () => ({ dt: { $gte: new Date(2026, 0, 1), $lt: new Date(2026, 5, 1) } }), exp: 'a' },
    { key: 'rv:B13', find: () => ({ dt: { $in: [new Date(2026, 0, 1), null] } }), exp: 'a,c,e,f,g,h,i,j,x_1' },
    { key: 'rv:B14', find: () => ({ value: { $in: [2, '3'] } }), exp: 'b,c,f' },
    { key: 'rv:B15', find: () => ({ value: { $in: [2, 'abc'] } }), exp: 'REJECT' },
    { key: 'rv:B16', find: () => ({ value: { $in: [2, true] } }), exp: 'REJECT' },
    { key: 'rv:B17', find: () => ({ value: /1/ }), exp: 'REJECT' }, //數值欄RegExp reject
    { key: 'rv:B18', find: () => ({ dt: /2026/ }), exp: 'REJECT' },
    { key: 'rv:B19', find: () => ({ name: { $regex: 'pet', $not: { $options: 'i' } } }), exp: 'REJECT' },

    //rv:C 主鍵條件位於深層邏輯(R-FIND-03: $nor、Op.not、頂層$not之內為否定語境)
    { key: 'rv:C1', find: () => ({ $nor: [{ $or: [{ id: 'A ' }, { value: { $gt: 7 } }] }] }), exp: 'b,c,e,f,g,h,i' },
    { key: 'rv:C2', find: () => ({ [Op.not]: { $or: [{ id: 'A ' }, { id: 'Ｂ' }] } }), exp: but('a', 'b') },
    { key: 'rv:C3', find: () => ({ $nor: [{ id: { $in: ['a', null] } }] }), exp: 'REJECT' }, //否定語境之null主鍵值reject
    { key: 'rv:C4', find: () => ({ $or: [{ id: { $in: ['a', null] } }, { name: 'abc' }] }), exp: 'a,g' },
    { key: 'rv:C5', find: () => ({ $not: {} }), exp: '' }, //頂層$not空物件: NOT(恆真)
    { key: 'rv:C6', find: () => ({ $not: { $and: [] } }), exp: 'REJECT' },
    { key: 'rv:C7', find: () => ({ $not: [{ id: 'a' }] }), exp: 'REJECT' }, //頂層$not之值為陣列reject(1.0.35誤刪)
    { key: 'rv:C8', find: () => ({ $nor: [{ id: { $not: 'A ' } }] }), exp: 'a' },
    { key: 'rv:C9', find: () => ({ $and: [{ id: { $ne: 'A ' } }, { $nor: [{ id: 'Ｂ' }] }] }), exp: but('a', 'b') },
    { key: 'rv:C10', find: () => ({ $nor: [{ [Op.and]: [{ $or: [{ id: 'A ' }] }] }] }), exp: but('a') },
    { key: 'new:NL1', find: () => ({ $and: [{ $not: { name: 'abc' } }] }), exp: but('e', 'g') }, //文件層$not位於$and元素內亦保留(Q2, R-FIND-03)
    { key: 'new:NL2', find: () => ({ $or: [{ $not: { id: 'A ' } }, { value: 0 }] }), exp: but('a') }, //$or元素內之文件層$not, 主鍵依Jet等值

    //rv2:D 主鍵欄 $not 與 Op.not 並存: 各自成一子式, 不互相覆寫(R-FIND-03)
    { key: 'rv2:D1', find: () => ({ id: { $not: { $gt: 'w' }, [Op.not]: { $lt: 'b' } } }), exp: 'b,c,d,e,f,g,h,i,j' },
    { key: 'rv2:D2', find: () => ({ id: { $not: /a/, [Op.not]: /x/ } }), exp: 'b,c,d,e,f,g,h,i,j' },
    { key: 'rv2:D3', find: () => ({ id: { $not: { $in: ['a'], $nin: ['b'] } } }), exp: but('a') },
    { key: 'rv2:D4', find: () => ({ id: { $not: { $gt: 'w' }, [Op.not]: 'a' } }), exp: 'b,c,d,e,f,g,h,i,j' },
    { key: 'rv2:D5', find: () => ({ value: { $not: { $gt: 5 }, [Op.not]: { $lt: 1 } } }), exp: 'a,b,c,e,f' },
]


if (isWindows()) {
    describe('WOrmMdb find pk(主鍵欄$not、cvFind分支、深層邏輯)', function() {

        let ctx = null

        before(async function() {
            ctx = await setupFind('find-pk', 'tc')
        })

        after(function() {
            cleanStorage(`./test/temp-find-pk`)
        })

        for (let c of CASES) {
            it(`${c.key}`, async function() {
                await runCase(ctx, c)
            })
        }

    })
}
