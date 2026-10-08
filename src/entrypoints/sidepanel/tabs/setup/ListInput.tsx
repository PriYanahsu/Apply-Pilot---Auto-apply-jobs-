/**
 * FILE: tabs/setup/ListInput.tsx
 * WHAT: A text box for comma-separated lists. Keeps your typing as-is and only splits it when you leave the box.
 * CALLED BY: tabs/setup/SearchSettingsSection.tsx
 */
import { useEffect, useState } from 'react';
import { splitList } from '../../ui';

export default function ListInput(props: { value: string[]; onChange: (items: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState(props.value.join(', '));
  useEffect(() => setText(props.value.join(', ')), [props.value]);
  return (
    <input
      value={text}
      placeholder={props.placeholder}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => props.onChange(splitList(text))}
    />
  );
}
