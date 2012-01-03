/*global document, location, io, XMLHttpRequest, setTimeout, setInterval, clearInterval, StyleFix, less, ActiveXObject*/
(function () {
    'use strict';

    if (!Array.prototype.indexOf) {
        Array.prototype.indexOf = function (o, from) {
            var i;
            for (i = from || 0; i < this.length; i += 1) {
                if (this[i] === o) {
                    return i;
                }
            }
            return -1;
        };
    }

    var pollTimeout = 2000,
        cleanHref = function (href) {
            var local = new RegExp('^' + document.location.protocol + '//' + document.location.host.replace(/[\.]/g, '\\$0') + '/', 'i'),
                remote = /:\/\/|^\/\//;

            href = href.replace(local, '');

            return !remote.test(href) && href;
        },
        findCssIncludes = function () {
            var cssIncludes = [],
                links = document.getElementsByTagName('link'),
                styles = document.getElementsByTagName('link'),
                style,
                cssRule,
                i,
                href;

            for (i = 0; i < links.length; i += 1) {
                if (/\bstylesheet\b/i.test(links[i].getAttribute('rel'))) {
                    href = cleanHref(links[i].getAttribute('href'));
                    if (href) {
                        cssIncludes.push({type: 'link', href: href, node: links[i]});
                    }
                }
            }

            for (i = 0 ; i < styles.length ; i += 1) {
                style = styles[i];

                if (typeof StyleFix !== 'undefined') {
                    // Prefixfree support
                    href = cleanHref(style.href || style.getAttribute('data-href'));

                    if (href) {
                        cssIncludes.push({type: 'prefixfree', href: href, node: style});
                    }
                }

                style.innerHTML.replace(/@import\s+(?:'([^']+)'|"([^"]+)"|url\(([^\)]+)\))/, function ($0, singleQuotedHref, doubleQuotedHref, urlParenthesesHref) {
                    if (urlParenthesesHref) {
                        urlParenthesesHref = urlParenthesesHref.replace(/^(['"])(.*)\1$/, '$2');
                    }
                    var href = singleQuotedHref || doubleQuotedHref || urlParenthesesHref;
                    cssIncludes.push({type: 'import', href: href, styleElement: style});
                });
            }

            return cssIncludes;
        },
        removeCacheBuster = function (href) {
            return href.replace(/[?&]livestyle=\d+/, '');
        },
        addCacheBuster = function (href) {
            return href + (href.indexOf('?') === -1 ? '?' : '&') + 'livestyle=' + new Date().getTime();
        },
        replaceLinkTag = function (node, href) {
            var parent = node.parentNode,
                newNode = node.cloneNode(true),
                monitor;

            newNode.href = href;

            parent.insertBefore(newNode, node);

            monitor = setInterval(function () {
                try {
                    if (newNode.sheet && newNode.sheet.cssRules.length > 0) { // Throws an error if the stylesheet hasn't loaded
                        clearInterval(monitor);
                        parent.removeChild(node);

                        // Less.js support (https://github.com/cloudhead/less.js)
                        if (/\bstylesheet\/less\b/i.test(newNode.getAttribute('rel')) && typeof less !== 'undefined') {
                            // Sadly this method isn't accessible
                            // less.loadStyleSheet(cssInclude.node, function () {}, false, 0);
                            // So instead we'll just have to brutally refresh ALL less includes
                            less.refresh();
                        }
                    }
                } catch (err) {}
            }, 50);
        },
        refresh = function (href) {
            var cssIncludes = findCssIncludes(),
                i,
                cssInclude,
                cssIncludeHref,
                newHref,
                replacerRegExp;

            for (i = 0; i < cssIncludes.length; i += 1) {
                cssInclude = cssIncludes[i];
                cssIncludeHref = removeCacheBuster(cssInclude.href);

                if (cssIncludeHref === href) {
                    newHref = addCacheBuster(href);

                    if (cssInclude.type === 'link') {
                        replaceLinkTag(cssInclude.node, newHref);
                    }

                    if (cssInclude.type === 'import') {
                        replacerRegExp = new RegExp("@import\\s+url\\(" + cssInclude.href.replace(/[\?\[\]\(\)\{\}]/g, "\\$&") + "\\)");
                        cssInclude.styleElement.innerHTML = cssInclude.styleElement.innerHTML.replace(replacerRegExp, '@import url(' + newHref + ')');
                    }

                    if (cssInclude.type === 'prefixfree') {
                        // The next two lines are hacks to make Prefixfree think this is a link and not a style block
                        cssInclude.node.setAttribute('href', href); // No cache buster needed
                        cssInclude.node.rel = 'stylesheet';
                        StyleFix.link(cssInclude.node);
                    }

                    // Replacing the first occurrence should be good enough. Besides, the @import replacement code invalidates
                    // the rest of the cssIncludes in the same stylesheet.
                    break;
                }
            }
        },
        startListening = function () {
            var socket = io.connect();

            socket.on('connect', function () {
                var hrefs = [],
                    watchNewStylesheets = function () {
                        var cssIncludes = findCssIncludes(),
                            toWatch = [],
                            url,
                            i;

                        for (i = 0; i < cssIncludes.length; i += 1) {
                            url = removeCacheBuster(cssIncludes[i].href);
                            if (hrefs.indexOf(url) === -1) {
                                hrefs.push(url);
                                toWatch.push(url);
                            }
                        }

                        if (toWatch.length !== 0) {
                            socket.emit('watch', toWatch, location.href);
                        }
                    };

                watchNewStylesheets();
                setInterval(watchNewStylesheets, pollTimeout);
            }).on('change', refresh);
        },
        state = {},
        startPolling = function () {
            var getXHR = function () {
                    try {
                        return new XMLHttpRequest();
                    } catch (e1) {
                        try {
                            return new ActiveXObject("Msxml2.XMLHTTP.6.0");
                        } catch (e2) {
                            try {
                                return new ActiveXObject("Msxml2.XMLHTTP.3.0");
                            } catch (e3) {
                                try {
                                    return new ActiveXObject("Msxml2.XMLHTTP");
                                } catch (e4) {
                                    try {
                                        return new ActiveXObject("Microsoft.XMLHTTP");
                                    } catch (e5) {}
                                }
                            }
                        }
                    }

                    return null; // no XHR support
                },
                cssIncludes = findCssIncludes(),
                proceed = function () {
                    var cssInclude,
                        url,
                        xhr;

                    if (cssIncludes.length > 0) {
                        cssInclude = cssIncludes.shift();
                        url = removeCacheBuster(cssInclude.href);
                        xhr = getXHR();

                        xhr.onreadystatechange = function () {
                            var lastModified,
                                etag;

                            if (xhr.readyState === 4) {
                                if (xhr.status === 200) {
                                    lastModified = Date.parse(xhr.getResponseHeader("Last-Modified"));
                                    etag = xhr.getResponseHeader("ETag");

                                    if (!state[url] || state[url].lastModified < lastModified || state[url].etag !== etag) {
                                        state[url] = {
                                            lastModified: lastModified,
                                            etag: etag
                                        };
                                        refresh(url);
                                    }
                                }

                                proceed();
                            }
                        };
                        xhr.open('HEAD', addCacheBuster(url), true);
                        xhr.send(null);
                    } else {
                        setTimeout(startPolling, pollTimeout);
                    }
                };

            proceed();
        };

    if (typeof io !== 'undefined') {
        startListening();
    } else {
        startPolling();
    }
}());