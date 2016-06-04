import RNTest from './react-native-testkit/'
import React from 'react'
import RNFetchBlob from 'react-native-fetch-blob'

import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Dimensions,
  Image,
} from 'react-native';
const { Assert, Comparer, Info, prop } = RNTest
const fs = RNFetchBlob.fs
const describe = RNTest.config({
  group : 'fs',
  expand : false,
  run : true
})

let { TEST_SERVER_URL, FILENAME, DROPBOX_TOKEN, styles, image } = prop()
let dirs = null

describe('Get storage folders', (report, done) => {
  fs.getSystemDirs().then((resp) => {
    dirs = resp
    report(
      <Assert key="system folders should exists" expect={resp} comparer={Comparer.exists} />,
      <Assert key="check properties"
        expect={resp}
        comparer={Comparer.hasProperties}
        actual={['DocumentDir', 'CacheDir', 'DCIMDir', 'DownloadDir']}
      />,
      <Info key="System Folders">
        <Text>{`${JSON.stringify(dirs)}`}</Text>
      </Info>
    )
    done()
  })

})

describe('ls API test', (report, done) => {
  fs.ls(dirs.DocumentDir).then((list) => {
    report(<Assert key="result must be an Array" expect={true} actual={Array.isArray(list)} />)
    return fs.ls('hh87h8uhi')
  })
  .then(()=>{})
  .catch((err) => {
    report(<Assert key="Wrong path should have error"
      expect={err}
      comparer={Comparer.exists}/>)
    done()
  })
})

describe('exists API test', (report, done) => {
  let exists = fs.exists
  exists(dirs.DocumentDir).then((exist, isDir) => {
    report(
      <Assert key="document dir should exist" expect={true} actual={exist}/>
    )
    return exists('blabajsdio')
  })
  .then((exist, isDir) => {
    report(
      <Assert key="path should not exist" expect={false} actual={exist}/>
    )
    done()
  })
})

describe('create file API test', (report, done) => {
  let p = dirs.DocumentDir + '/test-' + Date.now()
  let raw = 'hello ' + Date.now()
  let base64 = RNFetchBlob.base64.encode(raw)

  fs.createFile(p, raw, 'utf8')
    .then(() => {
      let stream = fs.readStream(p, 'utf8')
      let d = ''
      stream.onData((chunk) => {
        d += chunk
      })
      stream.onEnd(() => {
        report(<Assert key="utf8 content test"  expect={raw} actual={d}/>)
        testBase64()
      })
    })
  function testBase64() {
    fs.createFile(p + '-base64', RNFetchBlob.base64.encode(raw), 'base64')
      .then(() => {
        let stream = fs.readStream(p + '-base64', 'utf8')
        let d = ''
        stream.onData((chunk) => {
          d += chunk
        })
        stream.onEnd(() => {
          report(<Assert
            key="base64 content test"
            expect={raw}
            actual={d}/>)
          // testASCII()
          done()
        })
      })
      .catch((err) => {
        console.log(err)
      })
  }
  function testASCII() {
    fs.createFile(p + '-ascii', raw, 'ascii')
      .then(() => {
        let stream = fs.readStream(p + '-ascii', 'ascii')
        let d = ''
        stream.onData((chunk) => {
          d += chunk
        })
        stream.onEnd(() => {
          report(<Assert
            key="ASCII content test"
            expect={raw}
            actual={d}/>)
          done()
        })
      })
      .catch((err) => {
        console.log(err)
      })
  }

})

describe('mkdir and isDir API test', (report, done) => {
  let p = dirs.DocumentDir + '/mkdir-test-' + Date.now()
  fs.mkdir(p).then((err) => {
    report(<Assert key="folder should be created without error"
      expect={undefined}
      actual={err} />)
    return fs.exists(p)
  })
  .then((exist) => {
    report(<Assert key="mkdir should work correctly" expect={true} actual={exist} />)
    return fs.isDir(p)
  })
  .then((isDir) => {
    report(<Assert key="isDir should work correctly" expect={true} actual={isDir} />)
    return fs.mkdir(p)
  })
  .then()
  .catch((err) => {
    report(<Assert key="isDir should not work when folder exists"
      expect={err}
      comparer={Comparer.hasValue}/>)
    done()
  })
})

describe('unlink and mkdir API test', (report, done) => {
  let p = dirs.DocumentDir + '/unlink-test-' + Date.now()
  fs.createFile(p, 'write' + Date.now(), 'utf8').then(() => {
    return fs.exists(p)
  })
  .then((exist) => {
    report(<Assert key="file created" expect={true} actual={exist} />)
    return fs.unlink(p).then(() => {
      return fs.exists(p)
    })
  })
  .then((exist) => {
    report(<Assert key="file removed" expect={false} actual={exist} />)
    return fs.mkdir(p + '-dir')
  })
  .then((err) => fs.exists(p + '-dir'))
  .then((exist) => {
    report(<Assert key="mkdir should success" expect={true} actual={exist} />)
    return fs.unlink(p + '-dir')
  })
  .then(() => fs.exists(p + '-dir'))
  .then((exist) => {
    report(<Assert key="folder should be removed" expect={false} actual={exist} />)
    done()
  })
})

describe('write stream API test', (report, done) => {

  let p = dirs.DocumentDir + '/write-stream' + Date.now()
  let expect = ''
  fs.createFile(p, '1234567890', 'utf8')
    .then(() => fs.writeStream(p, 'utf8', true))
    .then((ws) => {
      ws.write('11')
      ws.write('12')
      ws.write('13')
      ws.write('14')
      return ws.close()
    })
    .then(() => {
      let rs = fs.readStream(p, 'utf8')
      let d1 = ''
      rs.onData((chunk) => {
        d1 += chunk
      })
      rs.onEnd(() => {
        report(
          <Assert key="write data async test"
            expect={'123456789011121314'}
            actual={d1}/>)
          base64Test()
      })
    })
  function base64Test() {
    fs.writeStream(p, 'base64', false)
    .then((ws) => {
      for(let i = 0; i< 100; i++) {
        expect += String(i)
      }
      ws.write(RNFetchBlob.base64.encode(expect))
      return ws.close()
    })
    .then(() => {
      let rs = fs.readStream(p, 'base64')
      let d2 = ''
      rs.onData((chunk) => {
        d2 += chunk
      })
      rs.onEnd(() => {
        report(
          <Assert key="file should be overwritten by base64 encoded data"
            expect={RNFetchBlob.base64.encode(expect)}
            actual={d2} />)
        done()
      })
    })
  }
})

describe('mv API test', {timeout : 10000},(report, done) => {
  let p = dirs.DocumentDir + '/mvTest' + Date.now()
  let dest = p + '-dest-' + Date.now()
  let content = Date.now() + '-test'
  fs.createFile(p, content, 'utf8')
  .then(() => fs.mkdir(dest))
  .then(() => fs.mv(p, dest +'/moved'))
  .then(() => fs.exists(p))
  .then((exist) => {
    report(<Assert key="file should not exist in old path" expect={false} actual={exist}/>)
    return fs.exists(dest + '/moved')
  })
  .then((exist) => {
    report(<Assert key="file should be moved to destination" expect={true} actual={exist}/>)
    return fs.ls(dest)
  })
  .then((files) => {
    report(<Assert key="file name should be correct" expect={'moved'} actual={files[0]}/>)
    let rs = fs.readStream(dest + '/moved')
    let actual = ''
    rs.onData((chunk) => {
      actual += chunk
    })
    rs.onEnd(() => {
      report(<Assert key="file content should be correct" expect={content} actual={actual}/>)
      done()
    })
  })
})

describe('cp API test', {timeout : 10000},(report, done) => {
  let p = dirs.DocumentDir + '/cpTest' + Date.now()
  let dest = p + '-dest-' + Date.now()
  let content = Date.now() + '-test'
  fs.createFile(p, content, 'utf8')
  .then(() => fs.mkdir(dest))
  .then(() => fs.cp(p, dest +'/cp'))
  .then(() => fs.exists(dest +'/cp'))
  .then((exist) => {
    report(<Assert key="file should be copy to destination" expect={true} actual={exist}/>)
    return fs.ls(dest)
  })
  .then((files) => {
    report(<Assert key="file name should be correct" expect={'cp'} actual={files[0]}/>)
    let rs = fs.readStream(dest + '/cp')
    let actual = ''
    rs.onData((chunk) => {
      actual += chunk
    })
    rs.onEnd(() => {
      report(<Assert key="file content should be correct" expect={content} actual={actual}/>)
      done()
    })
  })
})

describe('ASCII data test', (report, done) => {
  let p = null
  let expect = 'fetch-blob-'+Date.now()
  fs.getSystemDirs()
    .then((dirs) => {
      p = dirs.DocumentDir + '/ASCII-test-' + Date.now()
      return fs.createFile(p, 'utf8')
    })
    .then(() => {
      return fs.writeStream(p, 'ascii', false)
    })
    .then((ofstream) => {
      let qq = []
      for(let i=0;i<expect.length;i++) {
        qq.push(expect[i].charCodeAt(0))
        ofstream.write([expect[i].charCodeAt(0)])
      }
      ofstream.write(['g'.charCodeAt(0), 'g'.charCodeAt(0)])
      return ofstream.close()
    })
    .then(() => {
      let ifstream = fs.readStream(p, 'ascii')
      let res = []
      ifstream.onData((chunk) => {
        res = res.concat(chunk)
      })
      ifstream.onEnd(() => {
        res = res.map((byte) => {
          return String.fromCharCode(byte)
        }).join('')
        report(
          <Assert key="data written in ASCII format should correct"
            expect={expect + 'gg'}
            actual={res}
          />)
        done()
      })
    })
})

describe('ASCII file test', (report, done) => {
  let p = ''
  let filename = ''
  let expect = []
  let base64 = RNFetchBlob.base64
  fs.getSystemDirs().then((dirs) => {
    p = dirs.DocumentDir + '/'
    filename = 'ASCII-file-test' + Date.now() + '.txt'
    expect = 'ascii test ' + Date.now()
    return fs.createFile(p + filename, getASCIIArray(expect), 'ascii')
  })
  .then(() => {
    let rs = fs.readStream(p + filename, 'base64')
    let actual = ''
    rs.onData((chunk) => {
      actual += chunk
    })
    rs.onEnd(() => {
      report(<Assert key="written data verify"
        expect={expect}
        actual={base64.decode(actual)}/>)
      done()
    })
  })
})

function getASCIIArray(str) {
  let r = []
  for(let i=0;i<str.length;i++) {
    r.push(str[i].charCodeAt(0))
  }
  return r
}