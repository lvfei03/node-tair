/*!
 * tair - lib/configServer.js
 * Copyright(c) 2012 Taobao.com
 * Author: kate.sf <kate.sf@taobao.com>
 */

/**
 * configServer module
 */



var packet = require('./packet');
var utils = require('./utils');
var encode = require('./transcoder').encode;
var getData = require('./comm').getData;

var MURMURHASH_M = 0x5bd1e995;
var debug = false;

exports.retrieveConfigure = function (groupName, configVersion, configServerList, callback, configServerIndex) {

  configServerIndex = configServerIndex || 0;
  if (configServerIndex > configServerList.length - 1) {
    configServerIndex = configServerList.length - 1;
  }

  var addr = configServerList[configServerIndex];

  var reqGetGroup = packet.requestGetGroupPacket(groupName, configVersion);
  var that = this;
  getData(addr, reqGetGroup, function (dataerr, data) {
    if (dataerr || !data) {
      if (configServerIndex >= configServerList.length - 1) {
        return callback(dataerr);
      } else {
        configServerIndex++;
        return exports.retrieveConfigure.apply(that, [groupName, configVersion, configServerList, callback, configServerIndex]);
      }
    }

    packet.responseGetGroupPacket(data, function (err, res) {
      if (err) {
        if (configServerIndex >= configServerList.length - 1) {
          return callback(err);
        } else {
          configServerIndex++;
          return exports.retrieveConfigure.apply(that, [groupName, configVersion, configServerList, callback, configServerIndex]);
        }
      }
      that.configVersion = res.configVersion;
      that.bucketCount = res.bucketCount;
      that.copyCount = res.copyCount;
      that.aliveNodes = res.aliveNode;
      if (res.serverList && res.serverList.length > 0) {
        that.serverList = res.serverList;
      }

      if (!that.aliveNodes || that.aliveNodes.length === 0) {
        if (configServerIndex >= configServerList.length - 1) {
          return callback(new Error('Tair: fatal error, no datanode is alive'));
        } else {
          configServerIndex++;
          return exports.retrieveConfigure.apply(that, [groupName, configVersion, configServerList, callback, configServerIndex]);
        }
      }
      if (that.bucketCount <= 0 || that.copyCount <= 0) {
        if (configServerIndex >= configServerList.length - 1) {
          return callback(new Error('Tair: bucket count or copy count can not be 0'));
        } else {
          configServerIndex++;
          return exports.retrieveConfigure.apply(that, [groupName, configVersion, configServerList, callback, configServerIndex]);
        }
      }
//      if (debug) {
//        console.log('configversion: ' + exports.configVersion);
//        console.log(res.configMap);
//        console.log('bucketCount: ' + exports.bucketCount);
//        console.log('copyCount: ' + exports.copyCount);
//        for (var ai in res.aliveNode)
//          console.log('aliveNode: ' + ai);
//        console.log('first in serverList: ' + exports.serverList[0][0].host + ':' + exports.serverList[0][0].port);
//      }

      return callback(null, res);
    });
  });

};

exports.getDataNode = function (key, isRead, fitJava) {
  if (!this.serverList || this.serverList.length === 0) {
    console.error("At %s , Tair: DataNode Server list is empty! key: %s", new Date(), key.toString());
    return 0;
  }
  if (fitJava) {
    var _key = new Buffer(key);
    key = new Buffer(_key.length + 1);
    key[0] = 0;
    _key.copy(key, 1);
  }
  var serverIdx = findServerIdx.apply(this, [encode(key, 'utf-8', false), fitJava]);
  var serverIp = 0;
  var i = 0;
  serverIp = this.serverList[i][serverIdx] ? this.serverList[i][serverIdx].host : 0;
  serverIp >>>= 0;
  if (!this.aliveNodes[serverIp]) {
    serverIp = 0;
    console.log("Tair: master server " + utils.longToIP(serverIp) + " had down");
  }

  if (serverIp == 0 && isRead) {
    for (i = 1; i < this.copyCount; ++i) {
      serverIp = this.serverList[i][serverIdx] ? this.serverList[i][serverIdx].host : 0;
      console.log("Tair: read operation try: " + utils.longToIP(serverIp));
      if (this.aliveNodes[serverIp]) {
        break;
      } else {
        serverIp = 0;
      }
    }
    if (serverIp == 0) {
      console.error("Tair Error: slave servers also" + " had down");
    }
  }
  if (serverIp == 0) {
    return 0;
  }
  return {host: utils.longToIP(serverIp), port: this.serverList[i][serverIdx].port, success: (serverIp !== 0)};

};

function findServerIdx (keyByte, fitJava) {
  var hash = murmurhash2(keyByte, fitJava); // cast to int is safe

  if ((this.serverList) && (this.serverList.length > 0)) {
    return parseInt(hash %= this.bucketCount, 10);
  }
  return 0;
}

function murmurhash2 (_str, fitJava) {
  var l = _str.length + 1,
    h = 97 ^ l,
    i = 0,
    k;

  var str = new Buffer(l);
  _str.copy(str);
  str[l - 1] = 0;

  if (fitJava) {
    l -= 1;
    h = 97 ^ l;
    str = _str;
  }

  while (l >= 4) {
    k =
      ((str[i] & 0xff)) |
        ((str[++i] & 0xff) << 8) |
        ((str[++i] & 0xff) << 16) |
        ((str[++i] & 0xff) << 24);

    k = (((k & 0xffff) * MURMURHASH_M) + ((((k >>> 16) * MURMURHASH_M) & 0xffff) << 16));
    k ^= k >>> 24;
    k = (((k & 0xffff) * MURMURHASH_M) + ((((k >>> 16) * MURMURHASH_M) & 0xffff) << 16));

    h = (((h & 0xffff) * MURMURHASH_M) + ((((h >>> 16) * MURMURHASH_M) & 0xffff) << 16)) ^ k;

    l -= 4;
    ++i;
  }

  switch (l) {
    case 3:
      h ^= (str[i + 2] & 0xff) << 16;
    case 2:
      h ^= (str[i + 1] & 0xff) << 8;
    case 1:
      h ^= (str[i] & 0xff);
      h = (((h & 0xffff) * MURMURHASH_M) + ((((h >>> 16) * MURMURHASH_M) & 0xffff) << 16));
  }

  h ^= h >>> 13;
  h = (((h & 0xffff) * MURMURHASH_M) + ((((h >>> 16) * MURMURHASH_M) & 0xffff) << 16));
  h ^= h >>> 15;

  return h >>> 0;
}
