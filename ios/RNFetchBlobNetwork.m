//
//  RNFetchBlobNetwork.m
//  RNFetchBlob
//
//  Created by wkh237 on 2016/6/6.
//  Copyright © 2016 wkh237. All rights reserved.
//


#import <Foundation/Foundation.h>
#import "RNFetchBlobNetwork.h"

#import "RNFetchBlob.h"
#import "RNFetchBlobConst.h"
#import "RNFetchBlobProgress.h"

#if __has_include(<React/RCTAssert.h>)
#import <React/RCTRootView.h>
#import <React/RCTLog.h>
#import <React/RCTEventDispatcher.h>
#import <React/RCTBridge.h>
#else
#import "RCTRootView.h"
#import "RCTLog.h"
#import "RCTEventDispatcher.h"
#import "RCTBridge.h"
#endif

////////////////////////////////////////
//
//  HTTP request handler
//
////////////////////////////////////////

NSMapTable * expirationTable;

__attribute__((constructor))
static void initialize_tables() {
    if (expirationTable == nil) {
        expirationTable = [[NSMapTable alloc] init];
    }
}


@implementation RNFetchBlobNetwork


- (id)init {
    self = [super init];
    if (self) {
        self.requestsTable = [NSMapTable mapTableWithKeyOptions:NSMapTableStrongMemory valueOptions:NSMapTableWeakMemory];

        self.taskQueue = [[NSOperationQueue alloc] init];
        self.taskQueue.qualityOfService = NSQualityOfServiceUtility;
        self.taskQueue.maxConcurrentOperationCount = 10;
    }

    return self;
}

+ (RNFetchBlobNetwork* _Nullable)sharedInstance {
    static id _sharedInstance = nil;
    static dispatch_once_t onceToken;

    dispatch_once(&onceToken, ^{
        _sharedInstance = [[self alloc] init];
    });

    return _sharedInstance;
}

- (void) sendRequest:(__weak NSDictionary  * _Nullable )options
       contentLength:(long) contentLength
              bridge:(RCTBridge * _Nullable)bridgeRef
              taskId:(NSString * _Nullable)taskId
         withRequest:(__weak NSURLRequest * _Nullable)req
            callback:(_Nullable RCTResponseSenderBlock) callback
{
    RNFetchBlobRequest *request = [[RNFetchBlobRequest alloc] init];
    [request sendRequest:options
           contentLength:contentLength
                  bridge:bridgeRef
                  taskId:taskId
             withRequest:req
      taskOperationQueue:self.taskQueue
                callback:callback];

    backgroundTask = [options valueForKey:@"IOSBackgroundTask"] == nil ? NO : [[options valueForKey:@"IOSBackgroundTask"] boolValue];
    followRedirect = [options valueForKey:@"followRedirect"] == nil ? YES : [[options valueForKey:@"followRedirect"] boolValue];
    isIncrement = [options valueForKey:@"increment"] == nil ? NO : [[options valueForKey:@"increment"] boolValue];
    redirects = [[NSMutableArray alloc] init];
    if(req.URL != nil)
        [redirects addObject:req.URL.absoluteString];

    // set response format
    NSString * rnfbResp = [req.allHTTPHeaderFields valueForKey:@"RNFB-Response"];
    if([[rnfbResp lowercaseString] isEqualToString:@"base64"])
        responseFormat = BASE64;
    else if([[rnfbResp lowercaseString] isEqualToString:@"utf8"])
        responseFormat = UTF8;
    else
        responseFormat = AUTO;

    NSString * path = [self.options valueForKey:CONFIG_FILE_PATH];
    NSString * ext = [self.options valueForKey:CONFIG_FILE_EXT];
	NSString * key = [self.options valueForKey:CONFIG_KEY];
    __block NSURLSession * session;

    bodyLength = contentLength;

    // the session trust any SSL certification
    NSURLSessionConfiguration *defaultConfigObject;

    defaultConfigObject = [NSURLSessionConfiguration defaultSessionConfiguration];

    if(backgroundTask)
    {
        defaultConfigObject = [NSURLSessionConfiguration backgroundSessionConfigurationWithIdentifier:taskId];
    }

    // set request timeout
    float timeout = [options valueForKey:@"timeout"] == nil ? -1 : [[options valueForKey:@"timeout"] floatValue];
    if(timeout > 0)
    {
        defaultConfigObject.timeoutIntervalForRequest = timeout/1000;
    }

    defaultConfigObject.sessionSendsLaunchEvents = YES;

    defaultConfigObject.HTTPMaximumConnectionsPerHost = 10;
    session = [NSURLSession sessionWithConfiguration:defaultConfigObject delegate:self delegateQueue:taskQueue];
    if(path != nil || [self.options valueForKey:CONFIG_USE_TEMP]!= nil)
    {
        respFile = YES;

		NSString* cacheKey = taskId;
		if (key != nil) {
            cacheKey = [self md5:key];
			if (cacheKey == nil) {
				cacheKey = taskId;
			}

			destPath = [RNFetchBlobFS getTempPath:cacheKey withExtension:[self.options valueForKey:CONFIG_FILE_EXT]];
            if ([[NSFileManager defaultManager] fileExistsAtPath:destPath]) {
				callback(@[[NSNull null], RESP_TYPE_PATH, destPath]);
                return;
            }
		}

        if(path != nil)
            destPath = path;
        else
            destPath = [RNFetchBlobFS getTempPath:cacheKey withExtension:[self.options valueForKey:CONFIG_FILE_EXT]];
    }
    else
    {
        respData = [[NSMutableData alloc] init];
        respFile = NO;
    }

    __block NSURLSessionDataTask * task;
    if (path && req.HTTPMethod == @"POST") {
        task = [session uploadTaskWithRequest:req fromFile:path];
    } else {
        task = [session dataTaskWithRequest:req];
    }

    [taskTable setObject:task forKey:taskId];
    [task resume];

    // network status indicator
    if([[options objectForKey:CONFIG_INDICATOR] boolValue] == YES)
        [[UIApplication sharedApplication] setNetworkActivityIndicatorVisible:YES];
    __block UIApplication * app = [UIApplication sharedApplication];

}

// #115 Invoke fetch.expire event on those expired requests so that the expired event can be handled
+ (void) emitExpiredTasks
{
    NSEnumerator * emu =  [expirationTable keyEnumerator];
    NSString * key;

    while((key = [emu nextObject]))
    {
        RCTBridge * bridge = [RNFetchBlob getRCTBridge];
        NSData * args = @{ @"taskId": key };
        [bridge.eventDispatcher sendDeviceEventWithName:EVENT_EXPIRE body:args];

    }
}

- (void) enableProgressReport:(NSString *) taskId config:(RNFetchBlobProgress *)config
{
    if (config) {
        @synchronized ([RNFetchBlobNetwork class]) {
            [self.requestsTable objectForKey:taskId].progressConfig = config;
        }
    }
}

- (void) enableUploadProgress:(NSString *) taskId config:(RNFetchBlobProgress *)config
{
    if (config) {
        @synchronized ([RNFetchBlobNetwork class]) {
            [self.requestsTable objectForKey:taskId].uploadProgressConfig = config;
        }
    }
}

- (void) cancelRequest:(NSString *)taskId
{
    NSURLSessionDataTask * task;

    @synchronized ([RNFetchBlobNetwork class]) {
        task = [self.requestsTable objectForKey:taskId].task;
    }

    if (task && task.state == NSURLSessionTaskStateRunning) {
        [task cancel];
    }
}

// removing case from headers
+ (NSMutableDictionary *) normalizeHeaders:(NSDictionary *)headers
{
    NSMutableDictionary * mheaders = [[NSMutableDictionary alloc]init];
    for (NSString * key in headers) {
        [mheaders setValue:[headers valueForKey:key] forKey:[key lowercaseString]];
    }

    return mheaders;
}

// #115 Invoke fetch.expire event on those expired requests so that the expired event can be handled
+ (void) emitExpiredTasks
{
    @synchronized ([RNFetchBlobNetwork class]){
        NSEnumerator * emu =  [expirationTable keyEnumerator];
        NSString * key;

        while ((key = [emu nextObject]))
        {
            RCTBridge * bridge = [RNFetchBlob getRCTBridge];
            id args = @{ @"taskId": key };
            [bridge.eventDispatcher sendDeviceEventWithName:EVENT_EXPIRE body:args];

        }

        // clear expired task entries
        [expirationTable removeAllObjects];
        expirationTable = [[NSMapTable alloc] init];
    }
}

@end
