import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { BranchScopeInterceptor } from './branch-scope.interceptor';

/**
 * The confinement has to hold at the query, not only in the branch switcher that normally
 * sets it. An audit found a Downtown cashier reading Central Plaza's settings, zones and
 * couriers by naming the branch in the URL, so these assertions are the fix's whole point.
 */
const DOWNTOWN = 'c18c351a-4b1e-412b-9107-aac4fe8bee6a';
const CENTRAL = '647d18d4-aebb-41f2-bf14-66832998450b';

function run(req: any) {
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of(null) };
  new BranchScopeInterceptor().intercept(context, next);
  return req;
}

describe('BranchScopeInterceptor', () => {
  it('answers a branch account about its own branch, whatever it asked for', () => {
    const req = run({ userBranchId: DOWNTOWN, query: { branchId: CENTRAL }, body: {} });
    expect(req.query.branchId).toBe(DOWNTOWN);
  });

  it('confines the body as well as the query, in both spellings', () => {
    const req = run({
      userBranchId: DOWNTOWN,
      query: { branch_id: CENTRAL },
      body: { branchId: CENTRAL, branch_id: CENTRAL, amount: '100' },
    });
    expect(req.query.branch_id).toBe(DOWNTOWN);
    expect(req.body.branchId).toBe(DOWNTOWN);
    expect(req.body.branch_id).toBe(DOWNTOWN);
    // Nothing else about the request is the interceptor's business.
    expect(req.body.amount).toBe('100');
  });

  it('leaves head office alone — one account looking at four shops is the point', () => {
    const req = run({ userBranchId: null, query: { branchId: CENTRAL }, body: { branch_id: CENTRAL } });
    expect(req.query.branchId).toBe(CENTRAL);
    expect(req.body.branch_id).toBe(CENTRAL);
  });

  it('overwrites a named branch but never adds one', () => {
    // "No branch given" means something to a handler — usually the whole tenant — and that
    // is the handler's decision to make, not this interceptor's.
    const req = run({ userBranchId: DOWNTOWN, query: {}, body: { branchId: '' } });
    expect(req.query.branchId).toBeUndefined();
    expect(req.body.branchId).toBe('');
  });

  it('survives a request with no session, no query and an array body', () => {
    expect(() => run({ userBranchId: undefined, query: undefined, body: undefined })).not.toThrow();
    const req = run({ userBranchId: DOWNTOWN, query: { branchId: CENTRAL }, body: [{ branchId: CENTRAL }] });
    expect(req.query.branchId).toBe(DOWNTOWN);
    expect(req.body[0].branchId).toBe(CENTRAL);
  });
});
