const params = new URLSearchParams(window.location.search);

/** `?solve=1` adds Solve buttons that play the solution out on the board. */
export const SOLVE_FLAG = params.get('solve') === '1';
