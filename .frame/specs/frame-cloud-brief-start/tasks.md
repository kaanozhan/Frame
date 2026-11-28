
- T17 · Ignore a begun part whose branch is gone: `withBegunBranches` takes the folder's local branches and gives `begunBranch: null` for an entry whose branch no longer exists, so its row reads Not started · Begin again (the dialog already allowed it); `cloudStartService.withBegunBranches` reads the local branches once per list or detail, and the dialog's prepare applies the same filter; tests
