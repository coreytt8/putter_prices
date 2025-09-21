import { useEffect, useState } from 'react';

export function useModelStats(model) {
  const [data, setData] = useState(null);
  const [state, setState] = useState({ loading: true, error: null });

  useEffect(() => {
    if (!model) return;
    let alive = true;
    setState({ loading: true, error: null });

    const url = `/api/model-stats?model=${encodeURIComponent(model)}`;
    fetch(url)
      .then(r => r.json())
      .then(j => { if (alive) { setData(j); setState({ loading:false, error:null }); }})
      .catch(e => { if (alive) setState({ loading:false, error:e.message || 'Error' }); });

    return () => { alive = false; };
  }, [model]);

  return { data, ...state };
}
