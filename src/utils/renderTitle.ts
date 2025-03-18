import figlet from 'figlet';

export const renderTitle = () => {
	const text = figlet.textSync('Discontentful CLI', {
		font: 'Small',
	});
	// console.log(`\n${text}\n`);
	return text;
};
