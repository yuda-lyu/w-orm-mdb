import Sequelize from 'sequelize'
import { isWindows, cleanStorage } from './unit-setup.mjs'
import { ALL_TK as ALL, but as butAll, setupFind, runCase } from './unit-find-setup.mjs'


//spec: CLAUDE_rulebook.md 之 R-WL(第 33 項批 2)、R-FIND-03/04 與 R-PK-02/03(整數主鍵: 標準整數字串轉數字、其餘字串與非整數為型別不符)
//本檔: 整數主鍵 k 且 opt.pk 非 id(資料表另有非主鍵文字欄 id), 審計複審之 int:I 組與本輪新增之 new:IK(嚴格鍵)
//exp: 命中之主鍵(排序後逗號串接), '' 為無命中, 'REJECT' 為應拒收; 每列之斷言見 unit-find-setup.mjs 之 runCase


let Op = Sequelize.Op

const OP = (nm) => new RegExp(`unsupported operator \\[\\${nm}\\]`) //白名單外之運算子, 原因詞彙取自 wsemi cvOrmFind

function but(...xs) {
    return butAll(ALL, ...xs)
}


const CASES = [
    { key: 'int:I1', find: () => ({ k: 2 }), exp: '2' },
    { key: 'int:I2', find: () => ({ k: '2' }), exp: '2' }, //標準整數字串轉數字(R-PK-02)
    { key: 'int:I3', find: () => ({ k: '02' }), exp: '' }, //型別不符, 肯定語境不命中
    { key: 'int:I4', find: () => ({ k: { $ne: '02' } }), exp: 'REJECT' }, //型別不符, 否定語境reject
    { key: 'int:I5', find: () => ({ k: { $in: [1, '2', 2.5] } }), exp: '1,2' },
    { key: 'int:I6', find: () => ({ k: { $nin: [2.5] } }), exp: 'REJECT' },
    { key: 'int:I7', find: () => ({ k: { $gt: '3' } }), exp: '4,5' }, //範圍值經normPk正規化
    { key: 'int:I8', find: () => ({ k: { $gt: 2.5 } }), exp: '' }, //已知限制(外審opus F2, 待主控裁示): 整數主鍵之範圍界限為非整數者恆不命中(同1.0.35); 嚴格語意應為 3,4,5, 此斷言記錄現況而非應然
    { key: 'int:I9', find: () => ({ k: /1/ }), exp: 'REJECT', rej: /unsupported value type/ }, //RegExp值已移除(1.0.36 為主鍵$regex, 用於整數欄reject)
    { key: 'int:I10', find: () => ({ id: 'A' }), exp: '1' }, //非主鍵之id欄依NOCASE, 不經主鍵改寫
    { key: 'int:I11', find: () => ({ id: { $ne: 'b' } }), exp: '1,3,5' },
    { key: 'int:I12', find: () => ({ k: { $not: { $not: { $ne: '02' } } } }), exp: 'REJECT', rej: OP('$not') },
    { key: 'int:I13', find: () => ({ k: 1e20 }), exp: '' }, //超出LONG: 由Jet判定, 讀取未命中(L8)
    { key: 'int:I14', find: () => ({ k: { $ne: 1e20 } }), exp: ALL },
    { key: 'int:I15', find: () => ({ k: '2 ' }), exp: '' },
    { key: 'int:I16', find: () => ({ k: { $not: [2] } }), exp: 'REJECT', rej: OP('$not') }, //1.0.36 命中 but(2)
    { key: 'int:I16P', find: () => ({ k: { $nin: [2] } }), exp: but(2) }, //I16之白名單內寫法
    { key: 'int:I17', find: () => ({ $nor: [{ k: 'x' }] }), exp: 'REJECT', rej: OP('$nor') },
    { key: 'int:I18', find: () => ({ k: true }), exp: '' }, //布林為無效主鍵值, 肯定語境不命中
    { key: 'int:I19', find: () => ({ k: { $gte: 2, $lte: 3 } }), exp: '2,3' },
    { key: 'int:I20', find: () => ({ k: { [Op.in]: ['2', 4] } }), exp: 'REJECT', rej: /symbol key is not allowed/ }, //Symbol Op已移除(1.0.36 命中 2,4)
    { key: 'int:I20P', find: () => ({ k: { $in: ['2', 4] } }), exp: '2,4' }, //I20之白名單內寫法
    { key: 'int:I21', find: () => ({ k: { $regex: '1' } }), exp: 'REJECT', rej: OP('$regex') }, //$regex在白名單外
    { key: 'int:I22', find: () => ({ k: { $not: { $not: 2 } } }), exp: 'REJECT', rej: OP('$not') }, //雙層$not已移除(1.0.36 命中 2; 1.0.35誤刪)

    //new:IK 嚴格鍵: 主鍵之近似鍵不得繞過R-PK之正規化與Jet判定(reladb 1.1.9 R4)
    { key: 'new:IK1', find: () => ({ K: 2 }), exp: 'REJECT' },
    { key: 'new:IK2', find: () => ({ K: { $ne: '012' } }), exp: 'REJECT' },
    { key: 'new:IK3', find: () => ({ ID: 'a' }), exp: 'REJECT' }, //非主鍵之id欄之大小寫變體
]


if (isWindows()) {
    describe('WOrmMdb find intpk(整數主鍵且opt.pk非id)', function() {

        let ctx = null

        before(async function() {
            ctx = await setupFind('find-intpk', 'tk')
        })

        after(function() {
            cleanStorage(`./test/temp-find-intpk`)
        })

        for (let c of CASES) {
            it(`${c.key}`, async function() {
                await runCase(ctx, c)
            })
        }

    })
}
