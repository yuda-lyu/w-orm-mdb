import { isWindows, cleanStorage } from './unit-setup.mjs'
import { ALL_TC as ALL, but as butAll, setupFind, runCase } from './unit-find-setup.mjs'


//spec: CLAUDE_rulebook.md 之 R-FIND(非主鍵條件依 w-orm-reladb 1.1.9 帳本 R1–R6, 主鍵條件依本套件 R-PK-03/05)
//本檔: F 組(find 之形式)、V 組(欄位直給之值)、O 組(比較運算子)
//exp: 命中之主鍵(排序後逗號串接), '' 為無命中, 'REJECT' 為應拒收; 每列之斷言見 unit-find-setup.mjs 之 runCase


function but(...xs) {
    return butAll(ALL, ...xs)
}

class Cond {
    constructor() {
        this.id = 'a'
    }
}


const CASES = [
    //F: find 之形式(R-FIND-02; reladb R1)
    { key: 'F0', find: () => undefined, noArg: true, exp: ALL }, //未給: 全部(規格:250、:407)
    { key: 'F1', find: () => ({}), exp: ALL }, //{}: 全部
    { key: 'F2', find: () => null, exp: ALL }, //非物件視為{}: 系列現況保留(Q10)
    { key: 'F3', find: () => [], exp: ALL }, //陣列視為{}: 系列現況保留(Q10)
    { key: 'F4', find: () => 'a', exp: ALL }, //純量視為{}(Q10)
    { key: 'F5', find: () => 123, exp: ALL }, //純量視為{}(Q10)
    { key: 'F6', find: () => [{ id: 'a' }], exp: ALL }, //條件陣列視為{}(Q10)
    { key: 'F7', find: () => new Cond(), exp: 'REJECT' }, //非一般物件reject(reladb R1)
    { key: 'F8', find: () => Object.create({ id: 'a' }), exp: 'REJECT' }, //條件在原型: 非一般物件reject, 不得當{}全刪
    { key: 'F9', find: () => new Date(), exp: 'REJECT' }, //Date作為find: reject
    { key: 'F10', find: () => new Map([['id', 'a']]), exp: 'REJECT' }, //Map作為find: reject

    //V: 欄位直給之值(reladb R4; 主鍵依R-PK-03)
    { key: 'V1', find: () => ({ id: 'a' }), exp: 'a' },
    { key: 'V2', find: () => ({ value: 2 }), exp: 'b,f' },
    { key: 'V3', find: () => ({ name: null }), exp: 'e' }, //null為IS NULL(reladb R5)
    { key: 'V4', find: () => ({ value: 0 }), exp: 'g' },
    { key: 'V5', find: () => ({ name: '' }), exp: 'h' },
    { key: 'V6', find: () => ({ id: 'A' }), exp: 'a' }, //主鍵大小寫由Jet判定(R-PK-00)
    { key: 'V7', find: () => ({ value: '2' }), exp: 'b,f' }, //數值欄收十進位字串(reladb R4)
    { key: 'V8', find: () => ({ id: ['a', 'b'] }), exp: 'a,b' }, //陣列值即$in
    { key: 'V9', find: () => ({ name: /pet/i }), exp: 'a,b' }, //RegExp值即$regex(reladb R6)
    { key: 'V10', find: () => ({ name: undefined }), exp: 'REJECT' }, //undefined值reject(系列最低要求③)
    { key: 'V11', find: () => ({ id: 'a', value: 1 }), exp: 'a' }, //隱式and
    { key: 'V12', find: () => ({ nocol: 1 }), exp: 'REJECT' }, //model未列之欄: 嚴格鍵reject(R-FIND-04)
    { key: 'V13', find: () => ({ 'meta.a': 1 }), exp: 'REJECT' }, //點路徑: 不安全欄名reject
    { key: 'V14', find: () => ({ name: {} }), exp: 'REJECT' }, //非主鍵空物件: reject(reladb R4)
    { key: 'V15', find: () => ({ id: {} }), exp: '' }, //主鍵空物件為無效值, 肯定語境不命中(R-PK-03, Q5)
    { key: 'V16', find: () => ({ name: { a: 1 } }), exp: 'REJECT' }, //巢狀欄位物件reject
    { key: 'V17', find: () => ({ name: 123 }), exp: 'REJECT' }, //字串欄收數字: 型別不符reject(reladb R4)
    { key: 'V18', find: () => ({ value: 'abc' }), exp: 'REJECT' }, //數值欄收非數值字串reject
    { key: 'V19', find: () => ({ n: '2' }), exp: 'b,f' }, //整數欄收整數字串
    { key: 'V20', find: () => ({ n: 2.5 }), exp: '' }, //整數欄收非整數: 有限數值照比, 無命中
    { key: 'V21', find: () => ({ id: /X_/i }), exp: 'x_1' }, //主鍵之RegExp值即$regex(Q4, R-FIND-03)

    //O: 比較運算子(reladb R4、R5)
    { key: 'O1', find: () => ({ id: { $eq: 'a' } }), exp: 'a' },
    { key: 'O2', find: () => ({ name: { $eq: null } }), exp: 'e' },
    { key: 'O3', find: () => ({ value: { $ne: 2 } }), exp: 'a,c,e,g,h,i,j,x_1' }, //$ne不含NULL列(SQL三值, reladb R5)
    { key: 'O4', find: () => ({ name: { $ne: null } }), exp: but('e') },
    { key: 'O5', find: () => ({ value: { $gt: 2 } }), exp: 'c,e,i,j,x_1' },
    { key: 'O6', find: () => ({ value: { $gte: 2 } }), exp: 'b,c,e,f,i,j,x_1' },
    { key: 'O7', find: () => ({ value: { $lt: 2 } }), exp: 'a,g,h' },
    { key: 'O8', find: () => ({ value: { $lte: 2 } }), exp: 'a,b,f,g,h' },
    { key: 'O9', find: () => ({ value: { $gt: 0, $lt: 3 } }), exp: 'a,b,f' },
    { key: 'O10', find: () => ({ name: { $gt: 'p' } }), exp: 'a,b,c,i,x_1' }, //字串欄NOCASE(L4)
    { key: 'O11', find: () => ({ id: { $in: ['a', 'b'] } }), exp: 'a,b' },
    { key: 'O12', find: () => ({ id: { $in: [] } }), exp: '' }, //主鍵空$in: 不命中(R-PK-05)
    { key: 'O13', find: () => ({ name: { $in: [null, 'abc'] } }), exp: 'e,g' }, //$in含null即OR IS NULL(reladb R5)
    { key: 'O14', find: () => ({ id: { $nin: ['a', 'b'] } }), exp: but('a', 'b') },
    { key: 'O15', find: () => ({ id: { $nin: [] } }), exp: ALL }, //主鍵空$nin: 恆成立
    { key: 'O16', find: () => ({ value: { $nin: [1, 2] } }), exp: 'c,e,g,h,i,j,x_1' },
    { key: 'O17', find: () => ({ name: { $nin: [null] } }), exp: but('e') }, //$nin:[null]即IS NOT NULL
    { key: 'O18', find: () => ({ value: { $lt: 'abc' } }), exp: 'REJECT' }, //數值欄比非數值字串: reject(1.0.35誤刪)
    { key: 'O19', find: () => ({ name: { $in: ['PETER'] } }), exp: 'a,b' }, //NOCASE
    { key: 'O20', find: () => ({ n: { $in: ['2'] } }), exp: 'b,f' },
    { key: 'O21', find: () => ({ name: { $nin: ['abc', null] } }), exp: but('e', 'g') },
]


if (isWindows()) {
    describe('WOrmMdb find basic(F、V、O)', function() {

        let ctx = null

        before(async function() {
            ctx = await setupFind('find-basic', 'tc')
        })

        after(function() {
            cleanStorage(`./test/temp-find-basic`)
        })

        for (let c of CASES) {
            it(`${c.key}`, async function() {
                await runCase(ctx, c)
            })
        }

    })
}
