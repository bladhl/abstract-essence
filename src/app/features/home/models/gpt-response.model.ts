export interface ResponseObject{
	isValid: boolean,
	errorMessage: string;
	abstractType: string,
	sections: Section[]
}

export interface Section{
	sectionName: string,
	text: string
	uuid: string
}