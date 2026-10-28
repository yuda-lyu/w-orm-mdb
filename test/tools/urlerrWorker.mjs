//以不合格之opt.url建構WOrmMdb且不捕獲例外, 供unit-urlerr.test.mjs取得Node對未捕獲例外輸出之stderr
//用法: node test/tools/urlerrWorker.mjs <opt.url> [enc]
//註: src之位置依環境變數WORM_SRC_DIR(見srcDir.mjs), 未給則為本專案之src
import { importSrc } from './srcDir.mjs'


let { default: wo } = await importSrc('WOrmMdb.mjs')

wo({ url: process.argv[2], useEncryption: process.argv[3] === 'enc' })
