import wo from './src/WOrmMdb.mjs'
import fs from 'fs'


let username = ''
let password = ''
let opt = {
    url: `mdb://${username}:${password}`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'js', //default
    // autoGenPK: false,
    storage: './worm.mdb',
}

//因worm.mdb可能被修改, 先刪除再由worm_def.mdb複製一份來用
if (fs.existsSync(opt.storage)) {
    fs.unlinkSync(opt.storage)
}
fs.copyFileSync('./worm_def.mdb', opt.storage)

async function test() {
    //測試access mdb高併發狀況


    //w, 預先創建共用
    let w = wo(opt)


    //因事先會刪除故不用delAll


    async function core(name, n) {


        // //w, 若每次使用都創建實例就沒問題
        // let w = wo(opt)


        //save, 奇數時save
        if (n % 2 === 1) {
            let r = [
                {
                    id: `id-${name}-${n}`,
                    name: `${name}(modify)`,
                    value: n,
                },
            ]
            console.log('call save', n)
            w.save(r)
                .then(function(msg) {
                    console.log('save then', n, 'msg=', msg)
                })
                .catch(function(msg) {
                    console.log('save catch', n, 'msg=', msg)
                })

        }


        //select, 偶數時select
        if (n % 2 === 0) {
            console.log('call select', n)
            w.select()
                .then(function(msg) {
                    console.log('select then', n, 'len=', msg.length)
                })
                .catch(function(msg) {
                    console.log('select catch', n, 'msg=', msg)
                })
        }


    }


    let n = 0
    for (let i = 1; i <= 4; i++) {
        n += 1
        core('peter', n).catch((err) => {
            console.log(err)
        })
        // core('mary', n).catch((err) => {
        //     console.log(err)
        // })
        // core('sarah', n).catch((err) => {
        //     console.log(err)
        // })
    }


}
test()
// call save 1
// call select 2
// call save 3
// call select 4
// save then 1 msg= [ { n: 1, nInserted: 1, ok: 1 } ]
// select then 2 len= 1
// save then 3 msg= [ { n: 1, nInserted: 1, ok: 1 } ]
// select then 4 len= 2

//node --experimental-modules --es-module-specifier-resolution=node sp-mdb-js-concurrency.mjs
