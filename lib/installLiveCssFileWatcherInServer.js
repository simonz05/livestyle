var fs = require('fs'),
    path = require('path'),
    URL = require('url'),
    clientsByFileName = {};

function buildRelativeUrl(fromUrl, toUrl) {
    var minLength = Math.min(fromUrl.length, toUrl.length),
        commonPrefixLength = 0;
    while (commonPrefixLength < minLength && fromUrl[commonPrefixLength] === toUrl[commonPrefixLength]) {
        commonPrefixLength += 1;
    }
    var commonPrefix = fromUrl.substr(0, commonPrefixLength),
        commonPrefixMatch = commonPrefix.match(/^(file:\/\/|[^:]+:\/\/[^\/]+\/)/);

    if (commonPrefixMatch) {
        var fromFragments = fromUrl.substr(commonPrefixMatch[1].length).replace(/^\/+/, "").replace(/[^\/]+$/, "").split(/\//),
            toFragments = toUrl.substr(commonPrefixMatch[1].length).replace(/^\/+/, "").split(/\//);

        fromFragments.pop();

        var i = 0;
        while (i < fromFragments.length && i < toFragments.length && fromFragments[i] === toFragments[i]) {
            i += 1;
        }
        var relativeUrl = toFragments.slice(i).join("/");
        while (i < fromFragments.length) {
            relativeUrl = '../' + relativeUrl;
            i += 1;
        }
        return relativeUrl;
    } else {
        return toUrl; // No dice
    }
}

module.exports = function (app, dirName, sio) {
    var io = sio.listen(app);
    io.sockets.on('connection', function (client) {
        client.on('watch', function (assetUrls, pageUrl) {
            client.baseDir = dirName.replace(/\/$/, "") + path.dirname(URL.parse(pageUrl).pathname);
            assetUrls.forEach(function (assetUrl) {
                var rootRelativePath = URL.parse(URL.resolve(pageUrl, assetUrl)).pathname,
                    fileName = path.resolve(dirName, rootRelativePath.substr(1));
                if (fileName in clientsByFileName) {
                    clientsByFileName[fileName].push(client);
                } else {
                    clientsByFileName[fileName] = [client];
                    fs.watchFile(fileName, function (currStat, prevStat) {
                        if (currStat.mtime.getTime() !== prevStat.mtime.getTime()) {
                            clientsByFileName[fileName].forEach(function (client) {
                                var relativeUrl = buildRelativeUrl('file://' + client.baseDir,
                                                                   'file://' + fileName);
                                client.emit('change', relativeUrl);
                            });
                        }
                    });
                }
            });
        }).on('disconnect', function () {
            Object.keys(clientsByFileName).forEach(function (fileName) {
                var clients = clientsByFileName[fileName],
                    clientIndex = clients.indexOf(client);
                if (clientIndex !== -1) {
                    clients.splice(clientIndex, 1);
                }
            });
        });
    });
};