/** Keep one original request's classification across Runtime-owned projections. */
export function withinRequestScope(scope, classification, next) {
  return {
    [Symbol.asyncIterator]() {
      const iterator=scope.run(classification,()=>next()[Symbol.asyncIterator]());
      return {
        next:value=>scope.run(classification,()=>iterator.next(value)),
        return:value=>scope.run(classification,()=>iterator.return ? iterator.return(value) : Promise.resolve({done:true,value})),
        throw:error=>scope.run(classification,()=>iterator.throw ? iterator.throw(error) : Promise.reject(error)),
      };
    },
  };
}
