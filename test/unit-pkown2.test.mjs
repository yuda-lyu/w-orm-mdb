import { isWindows } from './unit-setup.mjs'
import { seedsStr, seedsInt, shapesStr, shapesInt, entries, expectStr, expectInt, observe, chkObs, initCtx } from './unit-pkown-setup.mjs'


//spec: sgud/rule/rulebook_pk.md 之 R-PKOWN-01(第569項; 共用層 unit-pkown-setup.mjs 載明 P1~P5)
//本檔: ①字串主鍵表users × autoGenPk為false(未帶者照既有整批reject, 不寫入、同值列不變; del該筆ok為0)
//     ②整數主鍵表ipk × autoGenPk兩值(繼承之有限數字亦視為未帶; 主鍵欄非字串類而autoGenPk為true時照既有訊息reject)


const nm = 'pkown2'


if (isWindows()) {
    describe('WOrmMdb pkown2(R-PKOWN-01; users × autoGenPk:false 與 ipk)', function() {

        let ctx = null
        let wOff = null
        let wIntOn = null
        let wIntOff = null

        before(async function() {
            ctx = await initCtx(nm)
            wOff = ctx.mkW('users', { autoGenPk: false }).w
            wIntOn = ctx.mkW('ipk', { autoGenPk: true }).w
            wIntOff = ctx.mkW('ipk', { autoGenPk: false }).w
        })

        after(function() {
            ctx.cleanup()
        })

        describe('users × autoGenPk:false', function() {
            for (let sh of shapesStr) {
                for (let sn of Object.keys(seedsStr)) {
                    for (let en of entries) {
                        if (en.only && !en.only.includes(sh.nm)) {
                            continue
                        }
                        it(`${sh.nm} × ${en.nm} × 同值列:${sn}`, async function() {
                            await ctx.seed('users', seedsStr[sn])
                            let obs = await observe(sh, en, wOff)
                            let db = await ctx.dump('users')
                            chkObs(obs, expectStr(sh, en, false, sn), db, `users|autoGenPk:false|${en.nm}|${sh.nm}|同值列:${sn}`)
                        })
                    }
                }
            }
        })

        for (let autoGenPk of [true, false]) {
            describe(`ipk(整數主鍵欄) × autoGenPk:${autoGenPk}`, function() {
                for (let sh of shapesInt) {
                    for (let sn of Object.keys(seedsInt)) {
                        for (let en of entries) {
                            if (en.only) {
                                continue
                            }
                            it(`${sh.nm} × ${en.nm} × 同值列:${sn}`, async function() {
                                await ctx.seed('ipk', seedsInt[sn])
                                let obs = await observe(sh, en, autoGenPk ? wIntOn : wIntOff)
                                let db = await ctx.dump('ipk')
                                chkObs(obs, expectInt(sh, en, autoGenPk, sn), db, `ipk|autoGenPk:${autoGenPk}|${en.nm}|${sh.nm}|同值列:${sn}`)
                            })
                        }
                    }
                }
            })
        }

    })
}
