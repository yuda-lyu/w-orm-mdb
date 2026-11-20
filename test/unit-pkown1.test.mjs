import { isWindows } from './unit-setup.mjs'
import { seedsStr, shapesStr, entries, expectStr, observe, chkObs, initCtx } from './unit-pkown-setup.mjs'


//spec: sgud/rule/rulebook_pk.md 之 R-PKOWN-01(第569項; 共用層 unit-pkown-setup.mjs 載明 P1~P5)
//本檔: 字串主鍵表users × autoGenPk為true × 入口 × 列形狀(繼承、自有不可列舉、Object.prototype被定義id、自有對照) × 有無與繼承值同值之既有列
//  P1 未帶者補新主鍵寫入(同值列原封不動); P3 insert不得跳過或撞鍵、save不得覆寫、del不得刪同值列


const nm = 'pkown1'


if (isWindows()) {
    describe('WOrmMdb pkown1(R-PKOWN-01; users × autoGenPk:true)', function() {

        let ctx = null
        let w = null

        before(async function() {
            ctx = await initCtx(nm)
            w = ctx.mkW('users', { autoGenPk: true }).w
        })

        after(function() {
            ctx.cleanup()
        })

        for (let sh of shapesStr) {
            for (let sn of Object.keys(seedsStr)) {
                for (let en of entries) {
                    if (en.only && !en.only.includes(sh.nm)) {
                        continue
                    }
                    it(`${sh.nm} × ${en.nm} × 同值列:${sn}`, async function() {
                        await ctx.seed('users', seedsStr[sn])
                        let obs = await observe(sh, en, w)
                        let db = await ctx.dump('users')
                        chkObs(obs, expectStr(sh, en, true, sn), db, `users|autoGenPk:true|${en.nm}|${sh.nm}|同值列:${sn}`)
                    })
                }
            }
        }

    })
}
